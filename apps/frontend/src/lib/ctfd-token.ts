import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getCtfd } from "./ctfd/client";
import { CtfdError } from "./ctfd/http";
import type { SsoClaims, SsoSession } from "./ctfd/types";
import { getKv, type KeyValueStore } from "./kv";
import { logger } from "./logger";
import { revalidateClaims, type RevalidateSource } from "./oidc-revalidate";
import { isRole, type Role } from "./roles";

/** Marge avant échéance : on renouvelle un token qui expire dans moins de 30 s. */
export const TOKEN_REFRESH_MARGIN_MS = 30_000;
/** Durée de vie du verrou de renouvellement (plus longue qu'un `POST /api/v1/sso/session` normal). */
export const REFRESH_LOCK_TTL_S = 15;
/** Attente maximale du token émis par un autre replica avant d'en émettre un soi-même. */
export const REFRESH_WAIT_MS = 6_000;
const REFRESH_POLL_MS = 100;

export interface StoredToken {
  token: string;
  /** Échéance en millisecondes epoch. */
  exp: number;
  /** Rôle CTFd à l'émission (resynchronisé depuis les groupes IdP relus, jamais ceux du JWE). */
  role?: Role;
}

interface Source {
  sub: string;
  claims: SsoClaims;
  token?: string;
  exp?: number;
  /** Fournisseur de la session ("mock" hors production) et refresh token OIDC, pour relire les groupes. */
  provider?: string;
  refreshToken?: string;
}

/** Dépendances injectables (tests : plusieurs « replicas » partageant un même store, sans CTFd réel). */
export interface TokenDeps {
  kv?: KeyValueStore;
  inflight?: Map<string, Promise<StoredToken | null>>;
  createSession?: (claims: SsoClaims) => Promise<Pick<SsoSession, "token" | "expiresAt"> & { role?: Role }>;
  /** Relecture des groupes auprès de l'IdP (défaut : refresh_token + userinfo Authentik). `null` = session invalide. */
  revalidate?: (src: RevalidateSource) => Promise<SsoClaims | null>;
  sleep?: (ms: number) => Promise<void>;
  /** Attente maximale d'un autre replica (défaut `REFRESH_WAIT_MS`). */
  waitMs?: number;
}

const processInflight = new Map<string, Promise<StoredToken | null>>();

function cacheKey(sub: string): string {
  return `ctfdtok:${createHash("sha256").update(sub).digest("hex").slice(0, 32)}`;
}

function usable(t: StoredToken | undefined | null, now: number): t is StoredToken {
  return !!t && !!t.token && t.exp - now > TOKEN_REFRESH_MARGIN_MS;
}

async function readCache(kv: KeyValueStore, key: string): Promise<StoredToken | null> {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    return typeof parsed.token === "string" && typeof parsed.exp === "number"
      ? { token: parsed.token, exp: parsed.exp, ...(isRole(parsed.role) ? { role: parsed.role } : {}) }
      : null;
  } catch {
    return null;
  }
}

/**
 * Prend le verrou de renouvellement de `key`. `held` vaut false si un autre replica renouvelle ;
 * on attend alors son résultat dans le cache partagé (singleflight inter-replicas). Si l'autre
 * échoue ou dépasse `REFRESH_WAIT_MS`, on émet nous-mêmes un token (fail-open : un verrou ne doit
 * jamais bloquer une connexion). Valkey indisponible : pas de verrou, chaque replica émet le sien.
 */
async function acquireOrWait(
  kv: KeyValueStore,
  key: string,
  owner: string,
  sleep: (ms: number) => Promise<void>,
  waitMs: number,
): Promise<{ held: boolean; token: StoredToken | null }> {
  const lockKey = `${key}:lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      if (await kv.setIfAbsent(lockKey, owner, REFRESH_LOCK_TTL_S)) return { held: true, token: null };
    } catch {
      return { held: false, token: null };
    }
    if (Date.now() >= deadline) return { held: false, token: null };
    await sleep(REFRESH_POLL_MS);
    const cached = await readCache(kv, key);
    if (usable(cached, Date.now())) return { held: false, token: cached };
  }
}

/**
 * Les tokens `sso_bridge` ont un TTL court (300 s par défaut) alors que la session Auth.js dure plusieurs heures.
 * Le token du JWE sert tant qu'il est valide ; ensuite un nouveau token est émis à partir de claims
 * RELUS auprès de l'IdP (refresh_token + userinfo), jamais de ceux du JWE, et partagé entre replicas (Valkey, TTL = durée de vie du token). Les cookies
 * ne peuvent pas être réécrits depuis un composant serveur, d'où ce cache côté serveur.
 *
 * Pas de stampede à l'échéance : dans un processus, les appels concurrents partagent une seule
 * promesse ; entre replicas, un verrou Valkey (`SET NX EX`) désigne l'unique replica qui appelle
 * `POST /api/v1/sso/session`, les autres relisent le token dans le cache partagé.
 *
 * Renvoie `null` si CTFd refuse l'identité (compte banni, groupes retirés, conflit d'e-mail).
 * Les erreurs d'indisponibilité (502...) sont propagées.
 */
export async function resolveCtfdToken(src: Source, now: number = Date.now(), deps: TokenDeps = {}): Promise<StoredToken | null> {
  if (src.token && src.exp && usable({ token: src.token, exp: src.exp }, now)) {
    return { token: src.token, exp: src.exp };
  }
  const kv = deps.kv ?? getKv();
  const inflight = deps.inflight ?? processInflight;
  const key = cacheKey(src.sub);
  const cached = await readCache(kv, key);
  if (usable(cached, now)) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;
  const run = (async () => {
    const owner = randomUUID();
    let held = false;
    try {
      const lock = await acquireOrWait(kv, key, owner, deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), deps.waitMs ?? REFRESH_WAIT_MS);
      if (lock.token) return lock.token;
      held = lock.held;
      if (held) {
        // Un autre replica a pu terminer entre notre lecture du cache et la prise du verrou.
        const fresh = await readCache(kv, key);
        if (usable(fresh, Date.now())) return fresh;
      }
      // Groupes relus auprès de l'IdP à CHAQUE émission : une rétrogradation (ou un retrait des
      // groupes CTF) prend effet à l'échéance du token CTFd, et les anciens groupes du JWE ne sont
      // jamais rejoués vers sso_bridge.
      const fresh = await (deps.revalidate ?? ((r) => revalidateClaims(r)))({
        sub: src.sub,
        claims: src.claims,
        provider: src.provider,
        refreshToken: src.refreshToken,
      });
      if (!fresh) {
        logger.warn("identité non revalidée auprès de l'IdP : session refusée");
        return null;
      }
      const s = await (deps.createSession ?? ((c) => getCtfd().createSession(c)))(fresh);
      const stored: StoredToken = { token: s.token, exp: s.expiresAt, ...(s.role ? { role: s.role } : {}) };
      const ttl = Math.floor((s.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS) / 1000);
      if (ttl > 0) {
        try {
          await kv.set(key, JSON.stringify(stored), ttl);
        } catch {
          // Cache indisponible : chaque replica réémettra son propre token.
        }
      }
      return stored;
    } catch (err) {
      if (err instanceof CtfdError && [400, 401, 403, 409].includes(err.status)) {
        logger.warn({ status: err.status }, "CTFd refuse l'identité de la session");
        return null;
      }
      throw err;
    } finally {
      if (held) {
        try {
          await kv.deleteIfEquals(`${key}:lock`, owner);
        } catch {
          // le verrou expire seul (REFRESH_LOCK_TTL_S)
        }
      }
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}
