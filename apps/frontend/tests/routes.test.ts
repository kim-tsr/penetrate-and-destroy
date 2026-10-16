import JSZip from "jszip";
import { NextRequest } from "next/server";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerSession } from "@/lib/session";
import { getCtfd } from "@/lib/ctfd/client";
import { resetFakeCtfd } from "@/mocks/ctfd-fake";
import { ctfdHandlers } from "@/mocks/handlers";

const state = vi.hoisted(() => ({ current: null as ServerSession | null }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => state.current }));

import { POST as attempt } from "@/app/api/challenges/[id]/attempt/route";
import { GET as getFile } from "@/app/api/files/[challengeId]/[index]/route";
import { GET as health } from "@/app/api/health/route";
import { DELETE as stopInstance, GET as getInstance, POST as startInstance } from "@/app/api/instances/[id]/route";
import { PATCH as patchEvent } from "@/app/api/manage/event/route";
import { POST as importRoute } from "@/app/api/manage/import/route";
import { DELETE as invalidate, PATCH as patchModeration } from "@/app/api/manage/moderation/[kind]/[id]/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { GET as notifications } from "@/app/api/notifications/route";
import { GET as scoreboard } from "@/app/api/scoreboard/route";
import { GET as scoreboardStream } from "@/app/api/scoreboard/stream/route";
import { POST as createTeam } from "@/app/api/team/route";

const server = setupServer(...ctfdHandlers("http://ctfd.test"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  state.current = null;
});
afterEach(() => resetFakeCtfd());
afterAll(() => server.close());

const HOST = "front.test";
function req(path: string, init: { method?: string; json?: unknown; form?: FormData; origin?: string | null } = {}) {
  const headers = new Headers({ host: HOST });
  if (init.origin !== null && init.method && init.method !== "GET") headers.set("origin", init.origin ?? `http://${HOST}`);
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  } else if (init.form) body = init.form;
  return new NextRequest(`http://${HOST}${path}`, { method: init.method ?? "GET", headers, body });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function loginAs(name: string, groups: string[] = ["ctf-players"]) {
  const s = await getCtfd().createSession({ sub: `sub-${name}`, email: `${name}@example.org`, preferred_username: name, groups });
  state.current = { name, email: `${name}@example.org`, role: s.role, userId: s.userId, ctfdToken: s.token };
  return s;
}

describe("POST /api/challenges/[id]/attempt", () => {
  it("401 sans session", async () => {
    const res = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "x" } }), params({ id: "1" }));
    expect(res.status).toBe(401);
  });
  it("403 si l'origine ne correspond pas (défense CSRF)", async () => {
    await loginAs("zoe");
    const res = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "x" }, origin: "https://evil.example" }), params({ id: "1" }));
    expect(res.status).toBe(403);
    const none = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "x" }, origin: null }), params({ id: "1" }));
    expect(none.status).toBe(403);
  });
  it("400 sur un corps ou un identifiant invalide", async () => {
    await loginAs("zoe");
    const empty = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "   " } }), params({ id: "1" }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).issues[0].path).toBe("submission");
    const badId = await attempt(req("/api/challenges/abc/attempt", { method: "POST", json: { submission: "x" } }), params({ id: "abc" }));
    expect(badId.status).toBe(400);
  });
  it("valide un flag correct et refuse un flag faux", async () => {
    await loginAs("zoe");
    const bad = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "PAD{non}" } }), params({ id: "1" }));
    expect(await bad.json()).toMatchObject({ status: "incorrect" });
    const ok = await attempt(req("/api/challenges/1/attempt", { method: "POST", json: { submission: "PAD{hello_operator}" } }), params({ id: "1" }));
    expect(await ok.json()).toMatchObject({ status: "correct" });
  });
  it("429 avec Retry-After au-delà de PAD_FLAG_RATE_LIMIT (3)", async () => {
    await loginAs("brute");
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) {
      last = await attempt(req("/api/challenges/2/attempt", { method: "POST", json: { submission: `PAD{${i}}` } }), params({ id: "2" }));
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("instances et équipes", () => {
  it("relaie les erreurs du plugin (403 sans équipe, 409 doublon)", async () => {
    await loginAs("zoe");
    const noTeam = await startInstance(req("/api/instances/3", { method: "POST" }), params({ id: "3" }));
    expect(noTeam.status).toBe(403);
    expect((await noTeam.json()).error).toMatch(/team/);

    const team = await createTeam(req("/api/team", { method: "POST", json: { name: "Zoe Team", password: "motdepasse" } }));
    expect(team.status).toBe(201);
    const started = await startInstance(req("/api/instances/3", { method: "POST" }), params({ id: "3" }));
    expect(started.status).toBe(201);
    expect((await started.json()).instance.connectionInfo).toMatch(/10\.20\.70\./);
    expect((await startInstance(req("/api/instances/3", { method: "POST" }), params({ id: "3" }))).status).toBe(409);
    expect((await (await getInstance(req("/api/instances/3"), params({ id: "3" }))).json()).instance).not.toBeNull();
    await stopInstance(req("/api/instances/3", { method: "DELETE" }), params({ id: "3" }));
    expect((await (await getInstance(req("/api/instances/3"), params({ id: "3" }))).json()).instance).toBeNull();
  });
  it("valide les identifiants d'équipe", async () => {
    await loginAs("zoe");
    const res = await createTeam(req("/api/team", { method: "POST", json: { name: "x", password: "1" } }));
    expect(res.status).toBe(400);
  });
});

describe("fichiers, annonces et scoreboard", () => {
  it("télécharge un fichier en pièce jointe, 404 sinon", async () => {
    await loginAs("zoe");
    const ok = await getFile(req("/api/files/5/0"), params({ challengeId: "5", index: "0" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/octet-stream");
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await getFile(req("/api/files/5/9"), params({ challengeId: "5", index: "9" }))).status).toBe(404);
  });
  it("liste les annonces depuis un identifiant", async () => {
    await loginAs("zoe");
    expect((await (await notifications(req("/api/notifications"))).json()).notifications).toHaveLength(1);
    expect((await (await notifications(req("/api/notifications?since=1"))).json()).notifications).toHaveLength(0);
    expect((await notifications(req("/api/notifications?since=abc"))).status).toBe(400);
  });
  it("sert le scoreboard sans session", async () => {
    const res = await scoreboard(req("/api/scoreboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.series.length).toBeGreaterThan(0);
  });
  it("ouvre un flux SSE qui pousse un premier instantané", async () => {
    const res = await scoreboardStream(req("/api/scoreboard/stream"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    const decoder = new TextDecoder();
    while (!text.includes("event: scoreboard")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toContain("retry: 3000");
    expect(text).toContain("event: scoreboard");
    expect(text).toContain("Red Pandas");
    await reader.cancel();
  });
});

describe("portail manager (BFF)", () => {
  async function zipFile(yml: string, name = "challenge.zip") {
    const z = new JSZip();
    z.file("challenge.yml", yml);
    return new File([await z.generateAsync({ type: "arraybuffer" })], name, { type: "application/zip" });
  }
  const form = (file: File | string) => {
    const f = new FormData();
    f.set("file", file);
    return f;
  };
  const YML = "name: Via BFF\ncategory: web\ndescription: d\nvalue: 5\nflags: [\"PAD{b}\"]\n";

  it("import : 403 joueur, 400 extension, 422 schéma, 201 puis 200", async () => {
    await loginAs("zoe");
    expect((await importRoute(req("/api/manage/import", { method: "POST", form: form(await zipFile(YML)) }))).status).toBe(403);

    await loginAs("max", ["ctf-managers"]);
    expect((await importRoute(req("/api/manage/import", { method: "POST", form: form(await zipFile(YML, "c.tar")) }))).status).toBe(400);
    expect((await importRoute(req("/api/manage/import", { method: "POST", form: form("pas un fichier") }))).status).toBe(400);

    const invalid = await importRoute(req("/api/manage/import", { method: "POST", form: form(await zipFile("name: X\ncategory: c\ndescription: d\nvalue: 1\nflags: []\n")) }));
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).details.join(" ")).toContain("flags");

    const created = await importRoute(req("/api/manage/import", { method: "POST", form: form(await zipFile(YML)) }));
    expect(created.status).toBe(201);
    expect((await created.json()).result).toMatchObject({ name: "Via BFF", action: "created" });
    expect((await importRoute(req("/api/manage/import", { method: "POST", form: form(await zipFile(YML)) }))).status).toBe(200);
  });
  it("événement : 400 sur un corps invalide, 200 sinon", async () => {
    await loginAs("max", ["ctf-managers"]);
    expect((await patchEvent(req("/api/manage/event", { method: "PATCH", json: {} }))).status).toBe(400);
    const ok = await patchEvent(req("/api/manage/event", { method: "PATCH", json: { paused: true } }));
    expect((await ok.json()).event.state).toBe("paused");
  });
  it("modération : réservée aux managers, via manager_api", async () => {
    const patch = (kind: string, id: string, json: unknown) =>
      patchModeration(req(`/api/manage/moderation/${kind}/${id}`, { method: "PATCH", json }), params({ kind, id }));
    await loginAs("zoe");
    expect((await patch("users", "1", { banned: true })).status).toBe(403);
    const max = await loginAs("max", ["ctf-managers"]);
    expect((await patch("users", "1", { banned: true })).status).toBe(200); // un manager suffit
    expect((await patch("teams", "1", { hidden: true })).status).toBe(200);
    expect((await patch("robots", "1", { banned: true })).status).toBe(400);
    expect((await patch("users", "1", {})).status).toBe(400);
    // Les refus de CTFd sont relayés : pas d'auto-modération, ni de modération d'un admin par un manager.
    expect((await patch("users", String(max.userId), { banned: true })).status).toBe(403);
    const root = await loginAs("root", ["ctf-admins"]);
    await loginAs("max", ["ctf-managers"]);
    expect((await patch("users", String(root.userId), { hidden: true })).status).toBe(403);
    expect((await patch("users", "9999", { banned: true })).status).toBe(404);
  });
  it("invalidation d'un solve et d'un award : managers uniquement", async () => {
    const del = (kind: string, id: string) =>
      invalidate(req(`/api/manage/moderation/${kind}/${id}`, { method: "DELETE" }), params({ kind, id }));
    await loginAs("zoe");
    expect((await del("submissions", "1")).status).toBe(403);
    await loginAs("max", ["ctf-managers"]);
    expect((await del("submissions", "1")).status).toBe(200);
    expect((await del("submissions", "1")).status).toBe(404);
    expect((await del("awards", "1")).status).toBe(404);
    expect((await del("users", "1")).status).toBe(400);
  });
});

describe("sondes", () => {
  it("/api/health répond ok sans dépendance externe", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", checks: { valkey: "memory" } });
  });
  it("/api/metrics expose pad_frontend_active_sessions", async () => {
    const text = await (await metrics(req("/api/metrics"))).text();
    expect(text).toContain("pad_frontend_active_sessions");
    expect(text).toContain("pad_frontend_http_requests_total");
  });
  it("/api/metrics exige le jeton Bearer quand il est configuré", async () => {
    vi.stubEnv("METRICS_TOKEN", "jeton-de-test");
    expect((await metrics(req("/api/metrics"))).status).toBe(401);
    const wrong = new NextRequest(`http://${HOST}/api/metrics`, { headers: { authorization: "Bearer autre" } });
    expect((await metrics(wrong)).status).toBe(401);
    const right = new NextRequest(`http://${HOST}/api/metrics`, { headers: { authorization: "Bearer jeton-de-test" } });
    expect((await metrics(right)).status).toBe(200);
    vi.unstubAllEnvs();
  });
  it("/api/metrics est fermée en production sans jeton", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("METRICS_TOKEN", "");
    expect((await metrics(req("/api/metrics"))).status).toBe(503);
    vi.unstubAllEnvs();
  });
});
