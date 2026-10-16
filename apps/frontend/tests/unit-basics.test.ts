import { describe, expect, it, vi } from "vitest";
import { buildCsp, generateNonce } from "@/lib/csp";
import { parseEnv } from "@/lib/env";
import { createMemoryStore } from "@/lib/kv";
import { rateLimit } from "@/lib/ratelimit";
import { canManage, hasRole, roleFromGroups } from "@/lib/roles";
import { attemptBody, eventBody, idParam, moderationBody, teamCredentials, zipUpload } from "@/lib/schemas";
import { formatDuration, safeCallbackPath } from "@/lib/utils";

describe("rôles", () => {
  it("déduit le rôle le plus élevé des groupes", () => {
    expect(roleFromGroups(["ctf-players"])).toBe("player");
    expect(roleFromGroups(["ctf-players", "ctf-managers"])).toBe("manager");
    expect(roleFromGroups(["ctf-admins", "ctf-managers"])).toBe("admin");
    expect(roleFromGroups(["infra-admins", "autre"])).toBeNull();
    expect(roleFromGroups(undefined)).toBeNull();
  });
  it("hiérarchise les rôles", () => {
    expect(hasRole("manager", "player")).toBe(true);
    expect(hasRole("player", "manager")).toBe(false);
    expect(hasRole(null, "player")).toBe(false);
    expect(canManage("admin")).toBe(true);
    expect(canManage("player")).toBe(false);
  });
});

describe("CSP", () => {
  it("est stricte en production", () => {
    const csp = buildCsp("abc", { dev: false, formActions: ["https://auth.example.test"] });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://auth.example.test");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("n'autorise unsafe-eval qu'en développement", () => {
    expect(buildCsp("n", { dev: true })).toContain("'unsafe-eval'");
  });
  it("génère des nonces uniques en base64", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("environnement", () => {
  const base = {
    AUTH_SECRET: "x".repeat(32),
    PAD_SSO_SHARED_SECRET: "y".repeat(32),
    AUTH_AUTHENTIK_ISSUER: "https://auth.example.test/application/o/pad-frontend/",
    AUTH_AUTHENTIK_SECRET: "secret",
    AUTH_URL: "https://ctf.example.test",
    METRICS_TOKEN: "tok",
  };
  it("accepte une configuration de production valide", () => {
    const env = parseEnv({ ...base, NODE_ENV: "production" });
    expect(env.PAD_MOCK).toBe(false);
    expect(env.AUTH_AUTHENTIK_ID).toBe("pad-frontend");
  });
  it("refuse PAD_MOCK=1 en production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", PAD_MOCK: "1" })).toThrow(/PAD_MOCK=1 est interdit/);
  });
  it("autorise PAD_MOCK=1 hors production sans IdP", () => {
    const env = parseEnv({ AUTH_SECRET: base.AUTH_SECRET, PAD_SSO_SHARED_SECRET: base.PAD_SSO_SHARED_SECRET, NODE_ENV: "development", PAD_MOCK: "1" });
    expect(env.PAD_MOCK).toBe(true);
  });
  it("exige l'IdP, AUTH_URL et METRICS_TOKEN en production", () => {
    expect(() => parseEnv({ AUTH_SECRET: base.AUTH_SECRET, PAD_SSO_SHARED_SECRET: base.PAD_SSO_SHARED_SECRET, NODE_ENV: "production" })).toThrow(
      /AUTH_AUTHENTIK_ISSUER.*AUTH_URL.*METRICS_TOKEN|AUTH_URL.*METRICS_TOKEN.*AUTH_AUTHENTIK_ISSUER|AUTH_AUTHENTIK_ISSUER/s,
    );
  });
  it("refuse les secrets trop courts", () => {
    expect(() => parseEnv({ ...base, AUTH_SECRET: "court" })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ ...base, PAD_SSO_SHARED_SECRET: "court" })).toThrow(/PAD_SSO_SHARED_SECRET/);
  });
});

describe("rate limiting", () => {
  it("bloque au-delà de la limite puis expose le délai restant", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) expect((await rateLimit(store, "k", 3, 60)).allowed).toBe(true);
    const blocked = await rateLimit(store, "k", 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect((await rateLimit(store, "autre", 3, 60)).allowed).toBe(true);
  });
  it("laisse passer si le store est en panne (fail-open)", async () => {
    const broken = { ...createMemoryStore(), incr: () => Promise.reject(new Error("down")) };
    expect((await rateLimit(broken, "k", 1, 60)).allowed).toBe(true);
  });
  it("refuse si le store est en panne en mode fail-closed (mot de passe d'équipe, flags)", async () => {
    const broken = { ...createMemoryStore(), incr: () => Promise.reject(new Error("down")) };
    const r = await rateLimit(broken, "k", 1, 60, { failClosed: true });
    expect(r.allowed).toBe(false);
    expect(r.unavailable).toBe(true);
  });
  it("compte les membres actifs sur la fenêtre", async () => {
    const store = createMemoryStore();
    await store.touch("s", "a", 1000);
    await store.touch("s", "b", 5000);
    expect(await store.countSince("s", 2000)).toBe(1);
  });
});

describe("verrou clé-valeur (SET NX)", () => {
  it("n'est pris que par un seul appelant concurrent, puis expire", async () => {
    vi.useFakeTimers();
    try {
      const store = createMemoryStore();
      const taken = await Promise.all([1, 2, 3, 4].map((n) => store.setIfAbsent("lock", `owner-${n}`, 10)));
      expect(taken.filter(Boolean)).toHaveLength(1);
      vi.advanceTimersByTime(11_000);
      expect(await store.setIfAbsent("lock", "owner-5", 10)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("ne libère que le verrou qu'on possède", async () => {
    const store = createMemoryStore();
    await store.setIfAbsent("lock", "moi", 10);
    await store.deleteIfEquals("lock", "autre");
    expect(await store.get("lock")).toBe("moi");
    await store.deleteIfEquals("lock", "moi");
    expect(await store.get("lock")).toBeNull();
  });
});

describe("validation zod des entrées", () => {
  it("valide les identifiants de route", () => {
    expect(idParam.parse({ id: "12" }).id).toBe(12);
    expect(() => idParam.parse({ id: "-1" })).toThrow();
    expect(() => idParam.parse({ id: "abc" })).toThrow();
    expect(() => idParam.parse({ id: "1; DROP" })).toThrow();
  });
  it("borne et nettoie les flags", () => {
    expect(attemptBody.parse({ submission: "  PAD{x}  " }).submission).toBe("PAD{x}");
    expect(() => attemptBody.parse({ submission: "" })).toThrow();
    expect(() => attemptBody.parse({ submission: "a".repeat(513) })).toThrow();
    expect(() => attemptBody.parse({})).toThrow();
  });
  it("valide les identifiants d'équipe", () => {
    expect(teamCredentials.safeParse({ name: "ok", password: "123456" }).success).toBe(true);
    expect(teamCredentials.safeParse({ name: "o", password: "123456" }).success).toBe(false);
    expect(teamCredentials.safeParse({ name: "ok", password: "123" }).success).toBe(false);
  });
  it("valide modération, événement et ZIP", () => {
    expect(moderationBody.safeParse({}).success).toBe(false);
    expect(moderationBody.safeParse({ banned: true }).success).toBe(true);
    expect(eventBody.safeParse({}).success).toBe(false);
    expect(eventBody.safeParse({ start: "2026-11-07T09:00:00Z", freeze: null }).success).toBe(true);
    expect(eventBody.safeParse({ start: "demain" }).success).toBe(false);
    expect(zipUpload.safeParse({ name: "a.ZIP", size: 10 }).success).toBe(true);
    expect(zipUpload.safeParse({ name: "a.tar", size: 10 }).success).toBe(false);
    expect(zipUpload.safeParse({ name: "a.zip", size: 51 * 1024 * 1024 }).success).toBe(false);
  });
});

describe("utilitaires", () => {
  it("formate les durées", () => {
    expect(formatDuration(65)).toBe("00:01:05");
    expect(formatDuration(90061)).toBe("1j 01:01:01");
    expect(formatDuration(-5)).toBe("00:00:00");
  });
  it("n'accepte que des redirections relatives", () => {
    expect(safeCallbackPath("/challenges/3")).toBe("/challenges/3");
    expect(safeCallbackPath("https://evil.example")).toBe("/dashboard");
    expect(safeCallbackPath("//evil.example")).toBe("/dashboard");
    expect(safeCallbackPath("/\\evil.example")).toBe("/dashboard");
    expect(safeCallbackPath("/login")).toBe("/dashboard");
    expect(safeCallbackPath(undefined)).toBe("/dashboard");
  });
});
