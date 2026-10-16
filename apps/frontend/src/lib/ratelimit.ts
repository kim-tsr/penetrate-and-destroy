import type { KeyValueStore } from "./kv";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Secondes avant réouverture de la fenêtre. */
  retryAfter: number;
}

export interface RateLimitOptions {
  /**
   * Panne du store : refuser (`true`) plutôt que laisser passer. À activer pour les garde-fous de
   * sécurité (mot de passe d'équipe, flags) ; le garde-fou global par IP reste fail-open pour ne
   * pas couper le site si Valkey tombe.
   */
  failClosed?: boolean;
}

/**
 * Fenêtre fixe partagée (INCR + EXPIRE NX) : suffisant pour freiner le brute-force tout en restant
 * atomique côté Valkey. Les clés portent toujours un TTL (condition de la politique `noeviction`
 * de Valkey, cf. gitops/platform/valkey). Panne du store : fail-open par défaut, fail-closed avec
 * `failClosed` (`allowed: false`, `unavailable: true`).
 */
export async function rateLimit(
  store: KeyValueStore,
  key: string,
  limit: number,
  windowSeconds: number,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult & { unavailable?: boolean }> {
  try {
    const { count, ttl } = await store.incr(`rl:${key}`, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: ttl };
  } catch {
    if (opts.failClosed) return { allowed: false, remaining: 0, retryAfter: 5, unavailable: true };
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}
