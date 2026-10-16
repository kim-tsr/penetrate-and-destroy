import "server-only";
import { createHash } from "node:crypto";
import { CtfdError } from "./ctfd/http";
import type { SsoClaims } from "./ctfd/types";
import { isMockMode } from "./env";
import { getKv, type KeyValueStore } from "./kv";
import { logger } from "./logger";

/** Durée de conservation du refresh token tournant côté serveur (alignée sur la session). */
export const REFRESH_TOKEN_KV_TTL_S = 4 * 60 * 60;

/** Indisponibilité de l'IdP : propagée (502), on ne déconnecte pas sur une panne. */
export class IdpUnavailableError extends CtfdError {
  constructor(message: string) {
    super(502, message);
    this.name = "IdpUnavailableError";
  }
}

export interface RevalidateSource {
  sub: string;
  claims: SsoClaims;
  /** Fournisseur d'origine de la session ("mock" : connexion simulée hors production). */
  provider?: string;
  /** Refresh token OIDC reçu à la connexion (scope offline_access). */
  refreshToken?: string;
}

export interface RevalidateDeps {
  kv?: KeyValueStore;
  fetchImpl?: typeof fetch;
}

interface Endpoints {
  token: string;
  userinfo: string;
  at: number;
}
let endpointsCache: { issuer: string; value: Endpoints } | null = null;
const ENDPOINTS_TTL_MS = 60 * 60 * 1000;

export function resetEndpointsCache(): void {
  endpointsCache = null;
}

export function refreshTokenKey(sub: string): string {
  return `oidc-rt:${createHash("sha256").update(sub).digest("hex").slice(0, 32)}`;
}

/** Mémorise le refresh token courant (rotation) ; appelé à la connexion et après chaque refresh. */
export async function storeRefreshToken(sub: string, refreshToken: string, kv: KeyValueStore = getKv()): Promise<void> {
  try {
    await kv.set(refreshTokenKey(sub), refreshToken, REFRESH_TOKEN_KV_TTL_S);
  } catch {
    // Store indisponible : le refresh token du JWE reste utilisable tant que l'IdP ne le fait pas tourner.
  }
}

async function discover(issuer: string, f: typeof fetch): Promise<Endpoints> {
  if (endpointsCache && endpointsCache.issuer === issuer && Date.now() - endpointsCache.value.at < ENDPOINTS_TTL_MS) {
    return endpointsCache.value;
  }
  let res: Response;
  try {
    res = await f(new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : `${issuer}/`), {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
  } catch {
    throw new IdpUnavailableError("IdP injoignable (discovery)");
  }
  if (!res.ok) throw new IdpUnavailableError(`IdP : discovery ${res.status}`);
  const doc = (await res.json()) as { token_endpoint?: unknown; userinfo_endpoint?: unknown };
  const origin = new URL(issuer).origin;
  const ok = (u: unknown): u is string => typeof u === "string" && new URL(u).origin === origin;
  if (!ok(doc.token_endpoint) || !ok(doc.userinfo_endpoint)) throw new IdpUnavailableError("IdP : discovery inattendue");
  const value = { token: doc.token_endpoint, userinfo: doc.userinfo_endpoint, at: Date.now() };
  endpointsCache = { issuer, value };
  return value;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Relit l'identité auprès de l'IdP (grant `refresh_token` puis `userinfo`) : les groupes renvoyés
 * sont ceux d'Authentik à l'instant T, jamais ceux du JWE. Renvoie `null` si la session n'est plus
 * valide (refresh token absent, révoqué ou expiré, utilisateur désactivé, `sub` différent) ; lève
 * `IdpUnavailableError` si l'IdP est en panne (on ne déconnecte pas pour autant).
 */
export async function revalidateClaims(src: RevalidateSource, deps: RevalidateDeps = {}): Promise<SsoClaims | null> {
  // Connexion simulée : pas d'IdP. Uniquement hors production (jamais en l'absence de PAD_MOCK).
  if (src.provider === "mock") return isMockMode() ? src.claims : null;

  const issuer = process.env.AUTH_AUTHENTIK_ISSUER;
  if (!issuer) return null;
  const kv = deps.kv ?? getKv();
  const f = deps.fetchImpl ?? fetch;

  let refreshToken: string | null = null;
  try {
    refreshToken = await kv.get(refreshTokenKey(src.sub));
  } catch {
    refreshToken = null;
  }
  refreshToken ||= src.refreshToken ?? null;
  if (!refreshToken) {
    logger.warn("pas de refresh token OIDC (scope offline_access absent ?) : session non revalidable");
    return null;
  }

  const ep = await discover(issuer, f);
  let tokenRes: Response;
  try {
    tokenRes = await f(ep.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.AUTH_AUTHENTIK_ID ?? "pad-frontend", // contracts: identity.oidc_clients.frontend
        client_secret: process.env.AUTH_AUTHENTIK_SECRET ?? "",
      }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
  } catch {
    throw new IdpUnavailableError("IdP injoignable (refresh)");
  }
  if (tokenRes.status >= 500) throw new IdpUnavailableError(`IdP : refresh ${tokenRes.status}`);
  if (!tokenRes.ok) {
    logger.warn({ status: tokenRes.status }, "refresh OIDC refusé : session invalidée");
    return null;
  }
  const tok = (await tokenRes.json()) as { access_token?: unknown; refresh_token?: unknown };
  const access = str(tok.access_token);
  if (!access) return null;
  if (str(tok.refresh_token)) await storeRefreshToken(src.sub, str(tok.refresh_token), kv);

  let infoRes: Response;
  try {
    infoRes = await f(ep.userinfo, {
      headers: { authorization: `Bearer ${access}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
  } catch {
    throw new IdpUnavailableError("IdP injoignable (userinfo)");
  }
  if (infoRes.status >= 500) throw new IdpUnavailableError(`IdP : userinfo ${infoRes.status}`);
  if (!infoRes.ok) return null;
  const info = (await infoRes.json()) as Record<string, unknown>;
  if (str(info.sub) !== src.sub) {
    logger.warn("userinfo : sub différent, session invalidée");
    return null;
  }
  const groups = Array.isArray(info.groups) ? info.groups.filter((g): g is string => typeof g === "string") : [];
  return {
    sub: src.sub,
    email: str(info.email) || src.claims.email,
    preferred_username: str(info.preferred_username) || str(info.name) || src.claims.preferred_username,
    groups, // jamais ceux du JWE : un claim `groups` absent = aucun groupe = refus par CTFd
  };
}
