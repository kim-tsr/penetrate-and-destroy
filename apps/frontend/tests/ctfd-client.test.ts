import { setupServer } from "msw/node";
import JSZip from "jszip";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HttpCtfdApi, getCtfd } from "@/lib/ctfd/client";
import { CtfdError } from "@/lib/ctfd/http";
import { ssoHeaders } from "@/lib/ctfd/sso";
import type { SsoClaims } from "@/lib/ctfd/types";
import { fakeState, resetFakeCtfd } from "@/mocks/ctfd-fake";
import { ctfdHandlers } from "@/mocks/handlers";

/** Le client HTTP réel (`HttpCtfdApi`) face au CTFd simulé, via msw : valide l'adaptation à apps/ctfd/API.md. */
const server = setupServer(...ctfdHandlers("http://ctfd.test"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => resetFakeCtfd());
afterAll(() => server.close());

const api = () => getCtfd();
const claims = (name: string, groups: string[] = ["ctf-players"]): SsoClaims => ({
  sub: `sub-${name}`,
  email: `${name}@example.org`,
  preferred_username: name,
  groups,
});
async function session(name: string, groups?: string[]) {
  return api().createSession(claims(name, groups));
}
async function failure(p: Promise<unknown>): Promise<CtfdError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(CtfdError);
    return err as CtfdError;
  }
  throw new Error("une erreur était attendue");
}

describe("sso_bridge", () => {
  it("émet un token par utilisateur avec le rôle issu des groupes", async () => {
    const p = await session("zoe");
    const m = await session("max", ["ctf-players", "ctf-managers"]);
    const a = await session("ada2", ["ctf-admins"]);
    expect([p.role, m.role, a.role]).toEqual(["player", "manager", "admin"]);
    expect(p.token).toMatch(/^ctfd_/);
    expect(p.expiresAt).toBeGreaterThan(Date.now());
  });
  it("refuse une signature produite avec un autre secret", async () => {
    const bad = new HttpCtfdApi(() => "x".repeat(40));
    expect((await failure(bad.createSession(claims("zoe")))).status).toBe(401);
  });
  it("refuse le rejeu d'un nonce", async () => {
    const body = JSON.stringify(claims("zoe"));
    const headers = ssoHeaders(process.env.PAD_SSO_SHARED_SECRET!, { method: "POST", path: "/api/v1/sso/session", body });
    const send = () => fetch("http://ctfd.test/api/v1/sso/session", { method: "POST", body, headers: { ...headers, "Content-Type": "application/json" } });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(401);
  });
  it("refuse un utilisateur sans groupe CTF", async () => {
    expect((await failure(api().createSession(claims("intrus", ["autre"])))).status).toBe(403);
  });
});

describe("joueur", () => {
  it("liste uniquement les challenges visibles et suit les résolutions", async () => {
    const s = await session("zoe");
    const list = await api().listChallenges(s.token);
    expect(list).toHaveLength(5);
    expect(list.find((c) => c.name === "Backstage")).toBeUndefined();
    expect(list.every((c) => !c.solvedByMe)).toBe(true);

    expect((await api().attempt(s.token, 1, "PAD{faux}")).status).toBe("incorrect");
    expect((await api().attempt(s.token, 1, "PAD{hello_operator}")).status).toBe("correct");
    expect((await api().attempt(s.token, 1, "PAD{hello_operator}")).status).toBe("already_solved");
    const after = await api().listChallenges(s.token);
    expect(after.find((c) => c.id === 1)).toMatchObject({ solvedByMe: true });
    expect((await api().getMe(s.token)).score).toBe(50);
  });
  it("refuse sans token valide", async () => {
    expect((await failure(api().listChallenges("ctfd_invalide"))).status).toBe(401);
  });
  it("débloque un indice et ne révèle son contenu qu'ensuite", async () => {
    const s = await session("zoe");
    const before = await api().getChallenge(s.token, 2);
    expect(before.hints[0]).toMatchObject({ unlocked: false, content: null });
    expect(await api().unlockHint(s.token, before.hints[0]!.id)).toMatchObject({ content: "Le décalage est de 13." });
    expect((await api().getChallenge(s.token, 2)).hints[0]?.unlocked).toBe(true);
  });
  it("sert un fichier sans exposer le token de fichier", async () => {
    const s = await session("zoe");
    const detail = await api().getChallenge(s.token, 5);
    expect(detail.files[0]?.href).toBe("/api/files/5/0");
    const res = await api().fetchChallengeFile(s.token, 5, 0);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toContain("dump.txt");
    expect(await api().fetchChallengeFile(s.token, 5, 9)).toBeNull();
  });
  it("le scoreboard est lisible sans token", async () => {
    const board = await api().getScoreboard(null);
    expect(board[0]).toMatchObject({ pos: 1 });
    expect(board.map((e) => e.name)).toContain("Red Pandas");
    const series = await api().getTopSeries(null, 3);
    expect(series.length).toBeGreaterThan(0);
  });
  it("les annonces sont filtrables par identifiant", async () => {
    const s = await session("zoe");
    expect(await api().getNotifications(s.token)).toHaveLength(1);
    expect(await api().getNotifications(s.token, 1)).toHaveLength(0);
  });
});

describe("équipes (pad_teams)", () => {
  it("crée, rejoint puis quitte une équipe avec les règles de CTFd", async () => {
    const cap = await session("capitaine");
    const mate = await session("coequipier");
    await api().createTeam(cap.token, { name: "Les Tests", password: "motdepasse" });
    expect((await failure(api().createTeam(cap.token, { name: "Autre", password: "motdepasse" }))).status).toBe(409);
    expect((await failure(api().joinTeam(mate.token, { name: "Les Tests", password: "mauvais" }))).status).toBe(403);
    await api().joinTeam(mate.token, { name: "Les Tests", password: "motdepasse" });

    const team = await api().getMyTeam(mate.token);
    expect(team?.members.map((m) => m.name).sort()).toEqual(["capitaine", "coequipier"]);
    expect(team?.captainId).toBe(cap.userId);

    expect((await failure(api().leaveTeam(cap.token))).status).toBe(409); // capitaine avec des membres
    await api().leaveTeam(mate.token);
    expect(await api().getMyTeam(mate.token)).toBeNull();
  });
});

describe("instances (chall_manager_bridge)", () => {
  it("exige une équipe, puis gère le cycle de vie complet", async () => {
    const s = await session("zoe");
    const noTeam = await failure(api().startInstance(s.token, 3));
    expect(noTeam.status).toBe(403);
    expect(noTeam.message).toMatch(/join a team/);

    await api().createTeam(s.token, { name: "Zoe Team", password: "motdepasse" });
    expect(await api().getInstance(s.token, 3)).toBeNull();

    const inst = await api().startInstance(s.token, 3);
    expect(inst).toMatchObject({ challengeId: 3, renewals: 0, maxRenewals: 3 });
    expect(inst.connectionInfo).toMatch(/10\.20\.70\./);
    expect(inst.until && Date.parse(inst.until)).toBeGreaterThan(Date.now());
    expect((await failure(api().startInstance(s.token, 3))).status).toBe(409);
    expect(await api().listInstances(s.token)).toHaveLength(1);

    expect((await api().extendInstance(s.token, 3)).renewals).toBe(1);
    await api().extendInstance(s.token, 3);
    await api().extendInstance(s.token, 3);
    expect((await failure(api().extendInstance(s.token, 3))).status).toBe(429);

    await api().stopInstance(s.token, 3);
    await api().stopInstance(s.token, 3); // idempotent
    expect(await api().getInstance(s.token, 3)).toBeNull();
  });
  it("404 pour un challenge non instancié", async () => {
    const s = await session("zoe");
    await api().createTeam(s.token, { name: "Zoe Team", password: "motdepasse" });
    expect((await failure(api().startInstance(s.token, 1))).status).toBe(404);
  });
});

describe("manager_api", () => {
  it("réserve les routes manager au rôle manager ou admin", async () => {
    const p = await session("zoe");
    expect((await failure(api().listManagedChallenges(p.token))).status).toBe(403);
    expect((await failure(api().getEvent(p.token))).status).toBe(403);
  });
  it("liste, statistiques et premier sang", async () => {
    const m = await session("max", ["ctf-managers"]);
    const { items, summary } = await api().listManagedChallenges(m.token);
    expect(items).toHaveLength(6); // inclut le challenge masqué
    expect(summary.solves).toBeGreaterThan(0);
    const stats = await api().getChallengeStats(m.token, 1, "hour");
    expect(stats).toMatchObject({ id: 1, solves: 3 });
    expect(stats.firstBlood?.accountName).toBe("Red Pandas");
    expect(stats.solvesOverTime.at(-1)?.cumulative).toBe(3);
    expect((await failure(api().getChallengeStats(m.token, 999))).status).toBe(404);
  });
  it("modifie l'événement et refuse les incohérences", async () => {
    const m = await session("max", ["ctf-managers"]);
    const paused = await api().updateEvent(m.token, { paused: true });
    expect(paused).toMatchObject({ paused: true, state: "paused" });
    expect((await api().updateEvent(m.token, { paused: false })).state).toBe("running");
    expect((await failure(api().updateEvent(m.token, { start: "2030-01-02T00:00:00Z", end: "2030-01-01T00:00:00Z" }))).status).toBe(422);
    const frozen = await api().updateEvent(m.token, { freeze: new Date(Date.now() - 60_000).toISOString() });
    expect(frozen.state).toBe("frozen");
  });
  it("bloque les soumissions pendant la pause", async () => {
    const m = await session("max", ["ctf-managers"]);
    const p = await session("zoe");
    await api().updateEvent(m.token, { paused: true });
    expect((await api().attempt(p.token, 1, "PAD{hello_operator}")).status).toBe("paused");
  });
  async function zip(yml: string, files: Record<string, string> = {}) {
    const z = new JSZip();
    z.file("challenge.yml", yml);
    for (const [n, c] of Object.entries(files)) z.file(n, c);
    return new Blob([await z.generateAsync({ type: "arraybuffer" })], { type: "application/zip" });
  }
  it("importe un challenge puis le met à jour (idempotent)", async () => {
    const m = await session("max", ["ctf-managers"]);
    const yml = "name: Importé\ncategory: web\ndescription: d\nvalue: 77\nflags:\n  - PAD{i}\nstate: visible\n";
    const created = await api().importChallenge(m.token, await zip(yml), "c.zip");
    expect(created).toMatchObject({ action: "created", name: "Importé", state: "visible", flags: 1 });
    const updated = await api().importChallenge(m.token, await zip(yml.replace("77", "88")), "c.zip");
    expect(updated).toMatchObject({ action: "updated", id: created.id, value: 88 });
    const p = await session("zoe");
    expect((await api().listChallenges(p.token)).some((c) => c.name === "Importé")).toBe(true);
  });
  it("importe un challenge instancié comme dynamic_instance", async () => {
    const m = await session("max", ["ctf-managers"]);
    const yml =
      "name: Inst\ncategory: pwn\ndescription: d\nvalue: 10\nflags: [\"PAD{i}\"]\ninstance:\n  image: registry.example.test/pad/x:1\n  ports: [1337]\n  ttl: 30m\n";
    expect(await api().importChallenge(m.token, await zip(yml), "c.zip")).toMatchObject({ type: "dynamic_instance", instance: true });
  });
  it("renvoie les erreurs de validation de CTFd (422) avec leur détail", async () => {
    const m = await session("max", ["ctf-managers"]);
    const err = await failure(api().importChallenge(m.token, await zip("name: X\ncategory: c\ndescription: d\nvalue: 1\nflags: []\n"), "c.zip"));
    expect(err.status).toBe(422);
    expect(JSON.stringify(err.body)).toContain("challenge.yml");
  });
});

describe("modération (manager_api)", () => {
  it("un manager liste, filtre et pagine les joueurs et les équipes", async () => {
    const m = await session("max", ["ctf-managers"]);
    await session("zoe");
    const users = await api().listUsers(m.token);
    expect(users.total).toBeGreaterThanOrEqual(5);
    expect(users.items.find((u) => u.name === "ada")).toMatchObject({ teamName: "Red Pandas", banned: false, roles: [] });
    expect(users.items.find((u) => u.name === "max")?.roles).toEqual(["manager"]);
    expect((await api().listUsers(m.token, { q: "zo" })).items.map((u) => u.name)).toEqual(["zoe"]);
    const page2 = await api().listUsers(m.token, { perPage: 2, page: 2 });
    expect(page2).toMatchObject({ page: 2, perPage: 2 });
    expect(page2.items).toHaveLength(2);
    const teams = await api().listTeams(m.token);
    expect(teams.items.find((t) => t.name === "Red Pandas")).toMatchObject({ memberCount: 1, banned: false });
  });
  it("bannit un joueur, qui perd ensuite l'accès, puis le débannit", async () => {
    const m = await session("max", ["ctf-managers"]);
    const p = await session("zoe");
    const zoe = (await api().listUsers(m.token, { q: "zoe" })).items[0]!;
    await api().moderateUser(m.token, zoe.id, { banned: true });
    expect((await failure(api().listChallenges(p.token))).status).toBe(403);
    await api().moderateUser(m.token, zoe.id, { banned: false });
    expect(await api().listChallenges(p.token)).toHaveLength(5);
  });
  it("réserve la modération aux managers", async () => {
    const p = await session("zoe");
    expect((await failure(api().listUsers(p.token))).status).toBe(403);
    expect((await failure(api().moderateTeam(p.token, 1, { hidden: true }))).status).toBe(403);
    expect((await failure(api().invalidateSubmission(p.token, 1))).status).toBe(403);
  });
  it("interdit l'auto-modération et protège managers et admins", async () => {
    const m = await session("max", ["ctf-managers"]);
    const other = await session("maya", ["ctf-managers"]);
    const root = await session("root", ["ctf-admins"]);
    expect((await failure(api().moderateUser(m.token, m.userId, { banned: true }))).status).toBe(403);
    expect((await failure(api().moderateUser(m.token, other.userId, { banned: true }))).status).toBe(403);
    expect((await failure(api().moderateUser(m.token, root.userId, { hidden: true }))).status).toBe(403);
    await api().moderateUser(root.token, other.userId, { hidden: true }); // un admin peut
    expect((await failure(api().moderateUser(m.token, 9999, { banned: true }))).status).toBe(404);
  });
  it("un joueur masqué disparaît du scoreboard", async () => {
    const m = await session("max", ["ctf-managers"]);
    const red = (await api().listTeams(m.token)).items.find((t) => t.name === "Red Pandas")!;
    await api().moderateTeam(m.token, red.id, { hidden: true });
    expect((await api().getScoreboard(null)).map((e) => e.name)).not.toContain("Red Pandas");
  });
  it("invalide un solve (le score et le first blood sont recalculés) et un award", async () => {
    const m = await session("max", ["ctf-managers"]);
    const p = await session("zoe");
    expect((await api().listChallenges(p.token)).find((c) => c.id === 1)?.firstBloodBy?.accountName).toBe("Red Pandas");
    const solves = await api().listSubmissions(m.token, { type: "correct", perPage: 50 });
    const first = solves.items.filter((s) => s.challengeId === 1 && s.teamName === "Red Pandas");
    expect(first).toHaveLength(1);
    await api().invalidateSubmission(m.token, first[0]!.id);
    expect((await api().listChallenges(p.token)).find((c) => c.id === 1)?.firstBloodBy?.accountName).toBe("Blue Foxes");
    expect((await failure(api().invalidateSubmission(m.token, first[0]!.id))).status).toBe(404);

    fakeState().awards.push({ id: 1, name: "Bonus", value: 50, userId: p.userId, teamId: null, date: new Date().toISOString() });
    const awards = await api().listAwards(m.token);
    expect(awards.items[0]).toMatchObject({ name: "Bonus", value: 50, userName: "zoe" });
    await api().invalidateAward(m.token, 1);
    expect((await api().listAwards(m.token)).items).toHaveLength(0);
  });
});

describe("pad_public : événement et first blood", () => {
  it("un joueur lit l'événement sans passer par l'API manager", async () => {
    const p = await session("zoe");
    expect((await failure(api().getEvent(p.token))).status).toBe(403);
    const event = await api().getPublicEvent(p.token);
    expect(event).toMatchObject({ paused: false, state: "running" });
    expect(event.start).not.toBeNull();
    const m = await session("max", ["ctf-managers"]);
    await api().updateEvent(m.token, { paused: true });
    expect((await api().getPublicEvent(p.token)).state).toBe("paused");
  });
  it("refuse l'événement sans token valide", async () => {
    expect((await failure(api().getPublicEvent("ctfd_invalide"))).status).toBe(401);
  });
  it("expose le first blood dans la liste et le détail des challenges", async () => {
    const red = await session("ada2");
    await api().createTeam(red.token, { name: "Les Premiers", password: "motdepasse" });
    const list = await api().listChallenges(red.token);
    const hello = list.find((c) => c.id === 1)!;
    expect(hello.firstBlood).toBe("other");
    expect(hello.firstBloodBy).toMatchObject({ accountName: "Red Pandas", userName: "ada" });
    expect(Date.parse(hello.firstBloodBy!.date)).not.toBeNaN();
    expect(list.find((c) => c.id === 4)?.firstBloodBy).toBeNull(); // personne n'a résolu ret2win
    expect((await api().getChallenge(red.token, 1)).firstBloodBy?.accountName).toBe("Red Pandas");

    // Le premier sang de l'équipe courante est reconnu comme « mine ».
    expect((await api().attempt(red.token, 4, "PAD{ret2win_ez}")).status).toBe("correct");
    const after = await api().listChallenges(red.token);
    expect(after.find((c) => c.id === 4)).toMatchObject({ solvedByMe: true, firstBlood: "mine" });
    expect(after.find((c) => c.id === 4)?.firstBloodBy?.accountName).toBe("Les Premiers");
  });
  it("n'expose pas le first blood d'un challenge caché ni d'un compte masqué", async () => {
    const p = await session("zoe");
    const m = await session("max", ["ctf-managers"]);
    const blue = (await api().listTeams(m.token)).items.find((t) => t.name === "Red Pandas")!;
    await api().moderateTeam(m.token, blue.id, { hidden: true });
    const bloods = await api().listFirstBloods(p.token);
    expect(bloods.get(1)?.accountName).toBe("Blue Foxes"); // Red Pandas masquée
    expect(bloods.has(5)).toBe(true);
    // « Backstage » (id 6) est caché : invisible des joueurs, présent pour les managers.
    fakeState().solves.push({ id: 999, challengeId: 6, userId: 2, teamId: 2, date: new Date().toISOString() });
    expect((await api().listFirstBloods(p.token)).has(6)).toBe(false);
    expect((await api().listFirstBloods(m.token)).has(6)).toBe(true);
  });
  it("la grille reste disponible quand le plugin first blood échoue", async () => {
    const p = await session("zoe");
    vi.spyOn(HttpCtfdApi.prototype, "listFirstBloods").mockRejectedValue(new CtfdError(502, "CTFd ne répond pas"));
    const list = await api().listChallenges(p.token);
    expect(list).toHaveLength(5);
    expect(list.every((c) => c.firstBlood === null && c.firstBloodBy === null)).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("authentification du token (apps/ctfd/API.md, section 1.1)", () => {
  it("l'API native exige Content-Type JSON avec le token, les plugins non", async () => {
    const p = await session("zoe");
    const bare = { Authorization: `Token ${p.token}` };
    const native = await fetch("http://ctfd.test/api/v1/users/me", { headers: bare, redirect: "manual" });
    expect(native.status).toBe(302); // comme CTFd : redirection vers /login
    const json = await fetch("http://ctfd.test/api/v1/users/me", { headers: { ...bare, "Content-Type": "application/json" } });
    expect(json.status).toBe(200);
    expect((await fetch("http://ctfd.test/api/v1/pad/event", { headers: bare })).status).toBe(200);
  });
  it("le client envoie Content-Type JSON même pour un GET sans corps", async () => {
    const p = await session("zoe");
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch");
    await api().getMe(p.token);
    for (const call of spy.mock.calls) {
      const req = call[0] instanceof Request ? call[0] : new Request(call[0] as string, call[1]);
      if (req.url.includes("/users/me")) seen.push(req.headers.get("content-type") ?? "");
    }
    spy.mockRestore();
    expect(seen).toEqual(["application/json"]);
  });
  it("le téléchargement d'un fichier repose sur le ?token= de l'URL, jamais sur Authorization", async () => {
    const p = await session("zoe");
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await api().fetchChallengeFile(p.token, 5, 0);
    const downloads = spy.mock.calls
      .map((c) => (c[0] instanceof Request ? c[0] : new Request(c[0] as string, c[1])))
      .filter((r) => r.url.includes("/files/"));
    spy.mockRestore();
    expect(res?.status).toBe(200);
    expect(downloads).toHaveLength(1);
    expect(new URL(downloads[0]!.url).searchParams.get("token")).toBeTruthy();
    expect(downloads[0]!.headers.get("authorization")).toBeNull();
  });
});
