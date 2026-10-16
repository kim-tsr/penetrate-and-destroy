import Redis from "ioredis";
import { logger } from "./logger";

/**
 * Stockage clé-valeur partagé entre les replicas (Valkey, compatible Redis).
 * Sans `VALKEY_URL` (dev, tests), repli sur une implémentation mémoire mono-processus.
 */
export interface KeyValueStore {
  readonly kind: "valkey" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Pose la clé seulement si elle n'existe pas (`SET NX EX`) : true si prise. Sert de verrou entre replicas. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Supprime la clé uniquement si elle porte encore `value` (libération d'un verrou sans voler celui d'un autre). */
  deleteIfEquals(key: string, value: string): Promise<void>;
  /** Incrémente et pose le TTL à la création ; renvoie la valeur et le TTL restant. */
  incr(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }>;
  /** Marque un membre comme actif (score = timestamp ms) dans un ensemble trié. */
  touch(set: string, member: string, nowMs: number): Promise<void>;
  /** Nombre de membres actifs depuis `sinceMs`, après purge des plus anciens. */
  countSince(set: string, sinceMs: number): Promise<number>;
  ping(): Promise<boolean>;
}

class MemoryStore implements KeyValueStore {
  readonly kind = "memory" as const;
  private values = new Map<string, { value: string; expires: number }>();
  private sets = new Map<string, Map<string, number>>();

  async get(key: string) {
    const e = this.values.get(key);
    if (!e) return null;
    if (e.expires <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    // Pas d'`await` entre le test et l'écriture : atomique dans la boucle d'événements.
    const e = this.values.get(key);
    if (e && e.expires > Date.now()) return false;
    this.values.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async deleteIfEquals(key: string, value: string) {
    if (this.values.get(key)?.value === value) this.values.delete(key);
  }
  async incr(key: string, ttlSeconds: number) {
    const now = Date.now();
    const e = this.values.get(key);
    if (!e || e.expires <= now) {
      this.values.set(key, { value: "1", expires: now + ttlSeconds * 1000 });
      return { count: 1, ttl: ttlSeconds };
    }
    const count = Number(e.value) + 1;
    e.value = String(count);
    return { count, ttl: Math.ceil((e.expires - now) / 1000) };
  }
  async touch(set: string, member: string, nowMs: number) {
    let s = this.sets.get(set);
    if (!s) this.sets.set(set, (s = new Map()));
    s.set(member, nowMs);
  }
  async countSince(set: string, sinceMs: number) {
    const s = this.sets.get(set);
    if (!s) return 0;
    for (const [m, t] of s) if (t < sinceMs) s.delete(m);
    return s.size;
  }
  async ping() {
    return true;
  }
}

class ValkeyStore implements KeyValueStore {
  readonly kind = "valkey" as const;
  constructor(private readonly client: Redis) {}

  async get(key: string) {
    return this.client.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.client.set(key, value, "EX", ttlSeconds);
  }
  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    return (await this.client.set(key, value, "EX", ttlSeconds, "NX")) === "OK";
  }
  async deleteIfEquals(key: string, value: string) {
    // Compare-and-delete atomique (le préfixe de clé est appliqué par ioredis aux KEYS de l'EVAL).
    await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, value);
  }
  async incr(key: string, ttlSeconds: number) {
    const res = await this.client.multi().incr(key).expire(key, ttlSeconds, "NX").ttl(key).exec();
    const count = Number(res?.[0]?.[1] ?? 1);
    const ttl = Number(res?.[2]?.[1] ?? ttlSeconds);
    return { count, ttl: ttl > 0 ? ttl : ttlSeconds };
  }
  async touch(set: string, member: string, nowMs: number) {
    await this.client.zadd(set, nowMs, member);
  }
  async countSince(set: string, sinceMs: number) {
    const res = await this.client
      .multi()
      .zremrangebyscore(set, "-inf", `(${sinceMs}`)
      .zcard(set)
      .exec();
    return Number(res?.[1]?.[1] ?? 0);
  }
  async ping() {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}

const g = globalThis as unknown as { __padKv?: KeyValueStore };

export function getKv(): KeyValueStore {
  if (g.__padKv) return g.__padKv;
  const url = process.env.VALKEY_URL;
  if (url) {
    const client = new Redis(url, {
      keyPrefix: "pad:front:",
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on("error", (err) => logger.warn({ err: err.message }, "valkey indisponible"));
    g.__padKv = new ValkeyStore(client);
  } else {
    g.__padKv = new MemoryStore();
  }
  return g.__padKv;
}

/** Pour les tests unitaires uniquement. */
export function createMemoryStore(): KeyValueStore {
  return new MemoryStore();
}
