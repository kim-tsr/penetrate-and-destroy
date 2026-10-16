import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCtfd } from "@/lib/ctfd/client";
import { resolveCtfdToken, TOKEN_REFRESH_MARGIN_MS, type TokenDeps } from "@/lib/ctfd-token";
import { CtfdError } from "@/lib/ctfd/http";
import type { SsoClaims } from "@/lib/ctfd/types";
import { createMemoryStore, type KeyValueStore } from "@/lib/kv";
import { cacheEvent, getEventView } from "@/lib/event";
import { getGitSyncStatus } from "@/lib/git-sync";
import { getMetrics, markActive } from "@/lib/metrics";
import { netbirdState } from "@/lib/netbird";
import { resetFakeCtfd } from "@/mocks/ctfd-fake";
import { ctfdHandlers } from "@/mocks/handlers";

const server = setupServer(...ctfdHandlers("http://ctfd.test"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  (globalThis as { __padKv?: unknown }).__padKv = undefined;
});
afterEach(() => {
  resetFakeCtfd();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

const claims = (name: string, groups = ["ctf-players"]): SsoClaims => ({ sub: `sub-${name}`, email: `${name}@example.org`, preferred_username: name, groups });

describe("renouvellement du token CTFd (TTL court de sso_bridge)", () => {
  beforeEach(() => void vi.stubEnv("PAD_MOCK", "1"));
  it("réutilise le token du JWE tant qu'il est valide", async () => {
    const spy = vi.spyOn(getCtfd(), "createSession");
    const now = 1_000_000;
    const r = await resolveCtfdToken({ sub: "s", claims: claims("zoe"), provider: "mock", token: "ctfd_jwe", exp: now + 5 * 60_000 }, now);
    expect(r).toEqual({ token: "ctfd_jwe", exp: now + 5 * 60_000 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("réémet un token à l'approche de l'échéance, puis le partage via Valkey", async () => {
    const spy = vi.spyOn(getCtfd(), "createSession");
    const now = Date.now();
    const stale = { sub: "sub-zoe", claims: claims("zoe"), provider: "mock", token: "ctfd_vieux", exp: now + TOKEN_REFRESH_MARGIN_MS - 1000 };
    const first = await resolveCtfdToken(stale, now);
    expect(first?.token).toMatch(/^ctfd_mock_/);
    expect(first?.token).not.toBe("ctfd_vieux");
    // Un autre replica (même cache partagé) ne réémet pas.
    const second = await resolveCtfdToken(stale, now);
    expect(second?.token).toBe(first?.token);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dédoublonne les renouvellements concurrents", async () => {
    const spy = vi.spyOn(getCtfd(), "createSession");
    const src = { sub: "sub-zoe", claims: claims("zoe"), provider: "mock", token: "x", exp: 0 };
    const [a, b, c] = await Promise.all([resolveCtfdToken(src), resolveCtfdToken(src), resolveCtfdToken(src)]);
    expect(a?.token).toBe(b?.token);
    expect(b?.token).toBe(c?.token);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("renvoie null quand CTFd refuse l'identité (compte retiré des groupes CTF)", async () => {
    expect(await resolveCtfdToken({ sub: "sub-x", claims: claims("x", ["autre"]), provider: "mock", token: "x", exp: 0 })).toBeNull();
  });

  it("propage une indisponibilité de CTFd au lieu de déconnecter l'utilisateur", async () => {
    vi.spyOn(getCtfd(), "createSession").mockRejectedValue(Object.assign(new Error("CTFd ne répond pas"), { status: 502, name: "CtfdError" }));
    await expect(resolveCtfdToken({ sub: "sub-y", claims: claims("y"), provider: "mock", token: "x", exp: 0 })).rejects.toThrow(/CTFd ne répond pas/);
  });
});

describe("renouvellement du token : singleflight entre replicas (verrou Valkey)", () => {
  beforeEach(() => void vi.stubEnv("PAD_MOCK", "1"));
  const src = { sub: "sub-zoe", claims: claims("zoe"), provider: "mock", token: "x", exp: 0 };
  const quickSleep = () => new Promise<void>((r) => setTimeout(r, 2));
  /** N « replicas » : même store partagé, mais chacun son propre singleflight en processus. */
  function replicas(kv: KeyValueStore, n: number, createSession: NonNullable<TokenDeps["createSession"]>, extra: TokenDeps = {}) {
    return Array.from({ length: n }, () => ({ kv, inflight: new Map(), createSession, sleep: quickSleep, ...extra }) satisfies TokenDeps);
  }
  const issue = (calls: { n: number }, ttlMs = 900_000) => async () => {
    const n = ++calls.n;
    await new Promise((r) => setTimeout(r, 30)); // appel lent à CTFd : les autres replicas arrivent pendant ce temps
    return { token: `ctfd_${n}`, expiresAt: Date.now() + ttlMs };
  };

  it("un seul replica appelle sso_bridge, les autres relisent le token partagé", async () => {
    const kv = createMemoryStore();
    const calls = { n: 0 };
    const out = await Promise.all(replicas(kv, 6, issue(calls)).map((d) => resolveCtfdToken(src, Date.now(), d)));
    expect(calls.n).toBe(1);
    expect(new Set(out.map((t) => t?.token))).toEqual(new Set(["ctfd_1"]));
  });

  it("libère le verrou après succès, puis après échec", async () => {
    const kv = createMemoryStore();
    const [d1, d2] = replicas(kv, 2, issue({ n: 0 }));
    await resolveCtfdToken(src, Date.now(), d1!);
    expect(await kv.get(`ctfdtok:${(await import("node:crypto")).createHash("sha256").update(src.sub).digest("hex").slice(0, 32)}:lock`)).toBeNull();
    const refused = replicas(createMemoryStore(), 1, async () => {
      throw new CtfdError(403, "banni");
    })[0]!;
    expect(await resolveCtfdToken(src, Date.now(), refused)).toBeNull();
    expect(await resolveCtfdToken(src, Date.now(), refused)).toBeNull(); // le verrou n'est pas resté pris
    void d2;
  });

  it("si le replica propriétaire échoue, un autre prend le relais sans attendre l'expiration du verrou", async () => {
    const kv = createMemoryStore();
    let n = 0;
    const flaky: NonNullable<TokenDeps["createSession"]> = async () => {
      const call = ++n;
      await new Promise((r) => setTimeout(r, 20));
      if (call === 1) throw new CtfdError(502, "CTFd ne répond pas");
      return { token: "ctfd_relais", expiresAt: Date.now() + 900_000 };
    };
    const [a, b] = replicas(kv, 2, flaky);
    const results = await Promise.allSettled([resolveCtfdToken(src, Date.now(), a!), resolveCtfdToken(src, Date.now(), b!)]);
    // Celui qui avait le verrou échoue (502 propagé) ; l'autre reprend la main et obtient un token.
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const ok = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ token: string } | null>;
    expect(ok.value?.token).toBe("ctfd_relais");
    expect(n).toBe(2);
  });

  it("fail-open : un verrou orphelin ne bloque pas au-delà de l'attente maximale", async () => {
    const kv = createMemoryStore();
    const key = `ctfdtok:${(await import("node:crypto")).createHash("sha256").update(src.sub).digest("hex").slice(0, 32)}:lock`;
    await kv.setIfAbsent(key, "replica-mort", 60);
    const calls = { n: 0 };
    const [d] = replicas(kv, 1, issue(calls), { waitMs: 40 });
    const t = await resolveCtfdToken(src, Date.now(), d!);
    expect(t?.token).toBe("ctfd_1");
    expect(await kv.get(key)).toBe("replica-mort"); // le verrou d'un autre n'est jamais supprimé
  });

  it("fail-open : Valkey indisponible, chaque replica émet son token sans erreur", async () => {
    const broken = createMemoryStore();
    broken.setIfAbsent = async () => {
      throw new Error("valkey indisponible");
    };
    broken.get = async () => {
      throw new Error("valkey indisponible");
    };
    broken.set = async () => {
      throw new Error("valkey indisponible");
    };
    const calls = { n: 0 };
    const out = await Promise.all(replicas(broken, 2, issue(calls)).map((d) => resolveCtfdToken(src, Date.now(), d)));
    expect(out.map((t) => t?.token).sort()).toEqual(["ctfd_1", "ctfd_2"]);
  });

  it("n'émet pas de nouveau token tant que celui du cache partagé est valide (900 s, marge 30 s)", async () => {
    const kv = createMemoryStore();
    const calls = { n: 0 };
    const [d1, d2] = replicas(kv, 2, issue(calls));
    const first = await resolveCtfdToken(src, Date.now(), d1!);
    // 14 min plus tard : toujours valide ; à 14 min 40 s, la marge de 30 s est entamée.
    expect((await resolveCtfdToken(src, Date.now() + 14 * 60_000, d2!))?.token).toBe(first?.token);
    expect(calls.n).toBe(1);
    expect(TOKEN_REFRESH_MARGIN_MS).toBe(30_000);
  });
});

describe("événement", () => {
  it("se rabat sur les variables d'environnement sans copie", async () => {
    vi.stubEnv("PAD_EVENT_START", "2000-01-01T00:00:00Z");
    vi.stubEnv("PAD_EVENT_END", "2999-01-01T00:00:00Z");
    expect(await getEventView()).toMatchObject({ source: "env", state: "running" });
  });
  it("un manager rafraîchit la copie partagée lue ensuite par les pages publiques", async () => {
    const s = await getCtfd().createSession(claims("max", ["ctf-managers"]));
    const live = await getEventView({ role: "manager", ctfdToken: s.token });
    expect(live.source).toBe("ctfd");
    await getCtfd().updateEvent(s.token, { paused: true });
    await cacheEvent(await getCtfd().getEvent(s.token));
    expect(await getEventView()).toMatchObject({ source: "cache", state: "paused", paused: true });
  });
  it("un joueur lit l'événement en direct via pad/event, sans API manager", async () => {
    const m = await getCtfd().createSession(claims("max", ["ctf-managers"]));
    const p = await getCtfd().createSession(claims("zoe"));
    const managerSpy = vi.spyOn(getCtfd(), "getEvent");
    expect(await getEventView({ role: "player", ctfdToken: p.token })).toMatchObject({ source: "ctfd", state: "running" });
    await getCtfd().updateEvent(m.token, { paused: true });
    expect(await getEventView({ role: "player", ctfdToken: p.token })).toMatchObject({ source: "ctfd", state: "paused", paused: true });
    expect(managerSpy).not.toHaveBeenCalled();
    // La lecture d'un joueur alimente la copie utilisée par les pages publiques.
    expect(await getEventView()).toMatchObject({ source: "cache", state: "paused" });
  });
  it("repli propre sur la dernière copie, puis sur l'env, quand CTFd est indisponible", async () => {
    const p = await getCtfd().createSession(claims("zoe"));
    await getEventView({ role: "player", ctfdToken: p.token });
    vi.spyOn(getCtfd(), "getPublicEvent").mockRejectedValue(new CtfdError(502, "CTFd ne répond pas"));
    expect(await getEventView({ role: "player", ctfdToken: p.token })).toMatchObject({ source: "cache", state: "running" });
    (globalThis as { __padKv?: unknown }).__padKv = undefined; // copie perdue (Valkey vidé)
    vi.stubEnv("PAD_EVENT_START", "2000-01-01T00:00:00Z");
    vi.stubEnv("PAD_EVENT_END", "2001-01-01T00:00:00Z");
    expect(await getEventView({ role: "player", ctfdToken: p.token })).toMatchObject({ source: "env", state: "ended" });
  });
});

describe("métriques", () => {
  it("compte les utilisateurs actifs dans pad_frontend_active_sessions", async () => {
    await markActive(1);
    await markActive(2);
    await markActive(2);
    const text = await getMetrics().registry.metrics();
    expect(text).toMatch(/pad_frontend_active_sessions\{app="pad-frontend"\} 2/);
  });
  it("expose les compteurs de flags et d'appels CTFd", async () => {
    const s = await getCtfd().createSession(claims("zoe"));
    await getCtfd().getMe(s.token);
    getMetrics().flagSubmissions.inc({ result: "correct" });
    const text = await getMetrics().registry.metrics();
    expect(text).toContain('pad_frontend_flag_submissions_total{result="correct"');
    expect(text).toContain("pad_frontend_ctfd_request_duration_seconds_bucket");
  });
});

describe("NetBird", () => {
  const stub = (users: unknown[], peers: unknown[]) =>
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      return new Response(JSON.stringify(u.endsWith("/users") ? users : peers), { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

  it("renvoie unknown sans configuration", async () => {
    expect(await netbirdState("a@example.org")).toBe("unknown");
  });
  it("distingue connecté, enregistré et absent", async () => {
    vi.stubEnv("NETBIRD_API_URL", "https://vpn.example.test/api");
    vi.stubEnv("NETBIRD_API_TOKEN", "t");
    const users = [{ id: "u1", email: "A@example.org" }];
    expect(await netbirdState("a@example.org", stub(users, [{ user_id: "u1", connected: true }]))).toBe("connected");
    expect(await netbirdState("a@example.org", stub(users, [{ user_id: "u1", connected: false }]))).toBe("registered");
    expect(await netbirdState("b@example.org", stub(users, []))).toBe("absent");
  });
  it("dégrade en unknown si l'API échoue", async () => {
    vi.stubEnv("NETBIRD_API_URL", "https://vpn.example.test/api");
    vi.stubEnv("NETBIRD_API_TOKEN", "t");
    const failing = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await netbirdState("a@example.org", failing)).toBe("unknown");
  });
  it("envoie le jeton dans l'en-tête Authorization (jamais dans l'URL)", async () => {
    vi.stubEnv("NETBIRD_API_URL", "https://vpn.example.test/api");
    vi.stubEnv("NETBIRD_API_TOKEN", "jeton-secret");
    const f = stub([], []);
    await netbirdState("a@example.org", f);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).not.toContain("jeton-secret");
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: "Token jeton-secret" });
  });
});

describe("statut de synchro Git", () => {
  it("non configuré", async () => {
    expect(await getGitSyncStatus()).toEqual({ state: "unconfigured" });
  });
  it("valide le JSON publié par la CI", async () => {
    vi.stubEnv("PAD_GIT_SYNC_STATUS_URL", "https://ci.example.test/status.json");
    const ok = vi.fn(
      async () =>
        new Response(JSON.stringify({ commit: "abc123", branch: "main", syncedAt: "2026-10-16T10:00:00Z", results: [{ name: "web-sqli", status: "updated" }] })),
    ) as unknown as typeof fetch;
    const r = await getGitSyncStatus(ok);
    expect(r.state).toBe("ok");
    const bad = vi.fn(async () => new Response(JSON.stringify({ commit: 1 }))) as unknown as typeof fetch;
    expect((await getGitSyncStatus(bad)).state).toBe("unavailable");
    const down = vi.fn(async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    expect(await getGitSyncStatus(down)).toEqual({ state: "unavailable", reason: "HTTP 503" });
  });
});
