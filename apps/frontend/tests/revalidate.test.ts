import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCtfdToken } from "@/lib/ctfd-token";
import type { SsoClaims } from "@/lib/ctfd/types";
import { createMemoryStore } from "@/lib/kv";
import { IdpUnavailableError, refreshTokenKey, resetEndpointsCache, revalidateClaims } from "@/lib/oidc-revalidate";

const old: SsoClaims = { sub: "sub-bob", email: "bob@example.org", preferred_username: "bob", groups: ["ctf-players", "ctf-managers"] };

beforeEach(() => resetEndpointsCache());
afterEach(() => vi.unstubAllEnvs());

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeIdp(opts: { token?: Handler; userinfo?: Handler } = {}) {
  const calls: string[] = [];
  const f = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ token_endpoint: "https://auth.example.test/application/o/token/", userinfo_endpoint: "https://auth.example.test/application/o/userinfo/" });
    }
    if (url.endsWith("/token/")) return (opts.token ?? (() => Response.json({ access_token: "at", refresh_token: "rt2" })))(url, init);
    if (url.endsWith("/userinfo/")) return (opts.userinfo ?? (() => Response.json({ sub: "sub-bob", email: "bob@example.org", preferred_username: "bob", groups: ["ctf-players"] })))(url, init);
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

describe("revalidateClaims (refresh_token + userinfo Authentik)", () => {
  const src = { sub: "sub-bob", claims: old, refreshToken: "rt1" };

  it("renvoie les groupes ACTUELS de l'IdP, pas ceux du JWE, et mémorise le refresh token tournant", async () => {
    const kv = createMemoryStore();
    const idp = fakeIdp();
    const out = await revalidateClaims(src, { kv, fetchImpl: idp.f });
    expect(out?.groups).toEqual(["ctf-players"]);
    expect(await kv.get(refreshTokenKey("sub-bob"))).toBe("rt2");
    // Le refresh token tournant du store prime sur celui du JWE.
    let used = "";
    const idp2 = fakeIdp({
      token: (_u, init) => {
        used = String((init?.body as URLSearchParams).get("refresh_token"));
        return Response.json({ access_token: "at" });
      },
    });
    await revalidateClaims(src, { kv, fetchImpl: idp2.f });
    expect(used).toBe("rt2");
  });

  it("un claim groups absent donne zéro groupe (fail-closed)", async () => {
    const idp = fakeIdp({ userinfo: () => Response.json({ sub: "sub-bob", email: "bob@example.org" }) });
    expect((await revalidateClaims(src, { kv: createMemoryStore(), fetchImpl: idp.f }))?.groups).toEqual([]);
  });

  it("refus de l'IdP (refresh révoqué), sub différent ou refresh token absent : null", async () => {
    const kv = createMemoryStore();
    expect(await revalidateClaims(src, { kv, fetchImpl: fakeIdp({ token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) }).f })).toBeNull();
    expect(await revalidateClaims(src, { kv, fetchImpl: fakeIdp({ userinfo: () => Response.json({ sub: "sub-autre", groups: ["ctf-admins"] }) }).f })).toBeNull();
    expect(await revalidateClaims({ ...src, refreshToken: undefined }, { kv: createMemoryStore(), fetchImpl: fakeIdp().f })).toBeNull();
  });

  it("panne de l'IdP : erreur propagée (pas de déconnexion silencieuse)", async () => {
    const down = fakeIdp({ token: () => new Response("boom", { status: 503 }) });
    await expect(revalidateClaims(src, { kv: createMemoryStore(), fetchImpl: down.f })).rejects.toBeInstanceOf(IdpUnavailableError);
  });

  it("session simulée : refusée hors mode mock", async () => {
    expect(await revalidateClaims({ ...src, provider: "mock" })).toBeNull();
    vi.stubEnv("PAD_MOCK", "1");
    expect(await revalidateClaims({ ...src, provider: "mock" })).toEqual(old);
  });
});

describe("réémission du token CTFd : jamais d'anciens groupes", () => {
  it("transmet à sso_bridge les groupes relus, pas ceux du JWE", async () => {
    const createSession = vi.fn(async (c: SsoClaims) => ({ token: "t", expiresAt: Date.now() + 300_000, role: c.groups.includes("ctf-managers") ? ("manager" as const) : ("player" as const) }));
    const revalidate = vi.fn(async () => ({ ...old, groups: ["ctf-players"] }));
    const out = await resolveCtfdToken(
      { sub: old.sub, claims: old, token: "x", exp: 0 },
      Date.now(),
      { kv: createMemoryStore(), inflight: new Map(), createSession, revalidate },
    );
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ groups: ["ctf-players"] }));
    expect(out?.role).toBe("player");
  });

  it("session invalide côté IdP : pas d'appel à CTFd, résultat null", async () => {
    const createSession = vi.fn();
    const out = await resolveCtfdToken(
      { sub: old.sub, claims: old, token: "x", exp: 0 },
      Date.now(),
      { kv: createMemoryStore(), inflight: new Map(), createSession, revalidate: async () => null },
    );
    expect(out).toBeNull();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("le rôle émis est partagé via le cache entre replicas", async () => {
    const kv = createMemoryStore();
    const deps = { kv, inflight: new Map(), createSession: async () => ({ token: "t", expiresAt: Date.now() + 300_000, role: "player" as const }), revalidate: async () => old };
    await resolveCtfdToken({ sub: old.sub, claims: old, token: "x", exp: 0 }, Date.now(), deps);
    const second = await resolveCtfdToken({ sub: old.sub, claims: old, token: "x", exp: 0 }, Date.now(), { ...deps, inflight: new Map(), revalidate: async () => null });
    expect(second?.role).toBe("player");
  });
});
