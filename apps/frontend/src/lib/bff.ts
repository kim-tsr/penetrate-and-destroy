import "server-only";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AdapterError, errorDetails } from "./ctfd/adapter";
import { CtfdError } from "./ctfd/http";
import { getEnv } from "./env";
import { getKv } from "./kv";
import { logger } from "./logger";
import { getMetrics, markActive } from "./metrics";
import { rateLimit, type RateLimitOptions } from "./ratelimit";
import { hasRole, type Role } from "./roles";
import { getServerSession, type ServerSession } from "./session";

export function jsonError(status: number, message: string, extra?: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ error: message, ...extra }, { ...init, status });
}

/**
 * Défense CSRF des route handlers mutants : l'Origin (ou Referer) doit correspondre à l'hôte servi.
 * Les server actions ont déjà ce contrôle intégré dans Next.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Enveloppe commune : métriques, logs JSON, traduction des erreurs CTFd / zod en réponses HTTP. */
export function route<C = never>(
  name: string,
  handler: Handler<C>,
): (req: NextRequest, ...ctx: [C] extends [never] ? [] : [C]) => Promise<Response> {
  return async (req, ...rest) => {
    const ctx = rest[0] as C;
    const { httpRequests, httpDuration } = getMetrics();
    const end = httpDuration.startTimer({ route: name, method: req.method });
    let res: Response;
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) {
        res = jsonError(403, "Origine de la requête refusée");
      } else {
        // Garde-fou global par IP ; les limites fines (flags, import...) sont posées dans les handlers.
        await enforceRateLimit(`ip:${clientIp(req)}`, globalLimit(), 60);
        res = await handler(req, ctx);
      }
    } catch (err) {
      res = toErrorResponse(err, name);
    }
    end({ status: String(res.status) });
    httpRequests.inc({ kind: "api", route: name, method: req.method, status: String(res.status) });
    return res;
  };
}

/** Requêtes par minute et par IP, toutes routes confondues (`PAD_API_RATE_LIMIT`, large : des joueurs partagent parfois une IP NAT). */
function globalLimit(): number {
  const n = Number(process.env.PAD_API_RATE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 1200;
}

/**
 * IP du client. Chaîne de confiance : internet -> Traefik edge (écrase tout X-Forwarded-For entrant)
 * -> Traefik du cluster (`forwardedHeaders.trustedIPs` = edge, ajoute l'IP de son pair) -> BFF.
 * Le BFF reçoit donc `client, <edge>` : seules les `PAD_TRUSTED_PROXY_HOPS` dernières entrées
 * (ajoutées par nos proxys, 1 par défaut = l'edge) sont fiables ; le client est l'entrée juste avant.
 * Jamais la première entrée : c'est celle qu'un client peut forger. Valeur non-IP : "unknown".
 */
export function clientIp(req: Pick<NextRequest, "headers">, hops: number = trustedProxyHops()): string {
  const entries = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const candidate = entries.length > 0 ? entries[Math.max(0, entries.length - 1 - hops)] : req.headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : "unknown";
}

function trustedProxyHops(): number {
  const n = Number(process.env.PAD_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** Lève une réponse 429 (avec Retry-After) quand la fenêtre est épuisée. */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, opts: RateLimitOptions = {}): Promise<void> {
  const r = await rateLimit(getKv(), key, limit, windowSeconds, opts);
  if (r.unavailable) throw jsonError(503, "Service momentanément indisponible, réessaie dans un instant", undefined, { headers: { "Retry-After": "5" } });
  if (!r.allowed) {
    throw jsonError(429, "Trop de requêtes, patiente un instant", { retryAfter: r.retryAfter }, {
      headers: { "Retry-After": String(Math.max(1, r.retryAfter)) },
    });
  }
}

/** Limite dédiée à la soumission de flags (`PAD_FLAG_RATE_LIMIT` par `PAD_FLAG_RATE_WINDOW_S`). */
export async function enforceFlagRateLimit(userId: number, challengeId: number): Promise<void> {
  const env = getEnv();
  await enforceRateLimit(`flag:${userId}:${challengeId}`, env.PAD_FLAG_RATE_LIMIT, env.PAD_FLAG_RATE_WINDOW_S, { failClosed: true });
}

export function toErrorResponse(err: unknown, name: string): Response {
  if (err instanceof Response) return err;
  if (err instanceof ZodError) {
    return jsonError(400, "Requête invalide", { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (err instanceof CtfdError) {
    if (err.status >= 500) logger.error({ route: name, status: err.status, err: err.message }, "erreur CTFd");
    const status = err.status === 401 ? 401 : err.status >= 500 ? 502 : err.status;
    const details = errorDetails(err.body);
    return jsonError(status, err.message, details.length ? { details } : undefined);
  }
  if (err instanceof AdapterError) {
    logger.error({ route: name, err: err.message, issues: err.issues }, "réponse CTFd non conforme");
    return jsonError(502, "Réponse inattendue du moteur CTF");
  }
  logger.error({ route: name, err: (err as Error)?.message }, "erreur interne");
  return jsonError(500, "Erreur interne");
}

/** Session obligatoire pour un route handler ; lève une Response 401/403 interceptée par `route()`. */
export async function requireApiSession(req: NextRequest, minimum: Role = "player"): Promise<ServerSession> {
  const s = await getServerSession(req.headers);
  if (!s) throw jsonError(401, "Session expirée, reconnecte-toi");
  if (!hasRole(s.role, minimum)) throw jsonError(403, "Accès réservé");
  void markActive(s.userId);
  return s;
}
