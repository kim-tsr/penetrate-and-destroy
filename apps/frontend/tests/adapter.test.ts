import { describe, expect, it } from "vitest";
import * as A from "@/lib/ctfd/adapter";

/** Les fixtures reproduisent mot pour mot les exemples de apps/ctfd/API.md. */
describe("adapter : sso_bridge", () => {
  const raw = {
    success: true,
    data: {
      token: "ctfd_abc",
      token_id: 1,
      expires_at: "2026-10-16T12:15:00Z",
      ttl: 900,
      created: true,
      user: { id: 2, name: "alice", email: "alice@example.org", type: "user", roles: ["manager"], team_id: null, team_name: null },
    },
  };
  it("convertit la réponse de /api/v1/sso/session", () => {
    const s = A.toSsoSession(raw);
    expect(s).toMatchObject({ token: "ctfd_abc", userId: 2, name: "alice", role: "manager", teamId: null });
    expect(s.expiresAt).toBe(Date.parse("2026-10-16T12:15:00Z"));
  });
  it("déduit le rôle admin du type CTFd ou des rôles", () => {
    expect(A.roleFromCtfd("admin", [])).toBe("admin");
    expect(A.roleFromCtfd("user", ["admin"])).toBe("admin");
    expect(A.roleFromCtfd("user", ["manager"])).toBe("manager");
    expect(A.roleFromCtfd("user", [])).toBe("player");
  });
  it("se rabat sur le ttl sans expires_at", () => {
    const s = A.toSsoSession({ success: true, data: { ...raw.data, expires_at: undefined } }, 1_000);
    expect(s.expiresAt).toBe(1_000 + 900_000);
  });
  it("refuse une réponse sans token", () => {
    expect(() => A.toSsoSession({ success: true, data: { user: raw.data.user } })).toThrow(A.AdapterError);
  });
});

describe("adapter : instances (chall_manager_bridge)", () => {
  const instance = {
    challenge_id: 12,
    source_id: "team-3",
    connection_info: "nc 10.20.70.100 1337",
    since: "2026-10-16T10:00:00Z",
    last_renew: "2026-10-16T10:00:00Z",
    until: "2026-10-16T10:30:00.123456789Z",
    expires_in: 1750,
    renewals: 0,
    max_renewals: 3,
    renewals_left: 3,
    per_instance_flag: false,
  };
  it("tronque les nanosecondes et conserve les compteurs", () => {
    const i = A.toInstance({ success: true, data: instance });
    expect(i.until).toBe("2026-10-16T10:30:00.123Z");
    expect(i).toMatchObject({ challengeId: 12, connectionInfo: "nc 10.20.70.100 1337", expiresIn: 1750, renewalsLeft: 3, maxRenewals: 3 });
  });
  it("accepte expires_in null (sans échéance)", () => {
    const i = A.toInstance({ success: true, data: { ...instance, until: null, expires_in: null } });
    expect(i.until).toBeNull();
    expect(i.expiresIn).toBeNull();
  });
  it("convertit une liste", () => {
    expect(A.toInstances({ success: true, data: [instance, { ...instance, challenge_id: 13 }] })).toHaveLength(2);
  });
  it("normalizeIso rejette les dates illisibles", () => {
    expect(A.normalizeIso("pas une date")).toBeNull();
    expect(A.normalizeIso(null)).toBeNull();
  });
});

describe("adapter : manager_api", () => {
  it("liste des challenges et agrégats", () => {
    const r = A.toManagedChallenges({
      success: true,
      data: [{ id: 1, name: "c1", category: "web", type: "standard", state: "visible", value: 100, function: "static", instance: false, tags: ["easy"], solves: 2, attempts: 4, success_rate: 0.5 }],
      meta: { count: 1, solves: 2, attempts: 4, success_rate: 0.5 },
    });
    expect(r.items[0]).toMatchObject({ id: 1, name: "c1", solves: 2, successRate: 0.5, instanced: false });
    expect(r.summary).toEqual({ count: 1, solves: 2, attempts: 4, successRate: 0.5 });
  });
  it("statistiques d'un challenge", () => {
    const s = A.toChallengeStats({
      success: true,
      data: {
        id: 1, name: "c1", category: "web", type: "standard", state: "visible", value: 100, function: "static", instance: false, tags: [],
        solves: 2, attempts: 4, success_rate: 0.5, incorrect_attempts: 2,
        first_blood: { account_id: 5, account_name: "blue", user_id: 2, user_name: "alice", date: "2026-10-16T08:00:00Z" },
        bucket: "hour",
        solves_over_time: [{ t: "2026-10-16T08:00:00Z", solves: 1, cumulative: 1 }],
      },
    });
    expect(s.firstBlood).toEqual({ accountName: "blue", userName: "alice", date: "2026-10-16T08:00:00Z" });
    expect(s.incorrectAttempts).toBe(2);
    expect(s.solvesOverTime).toHaveLength(1);
  });
  it("first_blood null sans solve", () => {
    const s = A.toChallengeStats({ success: true, data: { id: 1, name: "c", first_blood: null } });
    expect(s.firstBlood).toBeNull();
  });
  it("résultat d'import", () => {
    const r = A.toImportResult({
      success: true,
      data: { id: 12, name: "web-sqli", action: "created", type: "dynamic_instance", state: "hidden", value: 200, instance: true, flags: 1, hints: 0, tags: 2, files: ["a.bin"], files_uploaded: ["a.bin"] },
    });
    expect(r).toMatchObject({ id: 12, action: "created", instance: true, filesUploaded: ["a.bin"] });
  });
  it("événement : epoch -> ISO, null conservé", () => {
    const e = A.toEventConfig({ success: true, data: { start: 1760600000, end: 1760700000, freeze: null, paused: false, state: "running" } });
    expect(e.start).toBe(new Date(1760600000 * 1000).toISOString());
    expect(e.freeze).toBeNull();
    expect(e.state).toBe("running");
    expect(A.isoToEpoch("2026-10-16T08:00:00Z")).toBe(Date.parse("2026-10-16T08:00:00Z") / 1000);
    expect(A.isoToEpoch(null)).toBeNull();
  });
  it("phase de l'événement déduite des dates", () => {
    const cfg = { start: "2026-10-16T08:00:00Z", end: "2026-10-16T20:00:00Z", freeze: "2026-10-16T18:00:00Z" };
    const t = (s: string) => Date.parse(s);
    expect(A.eventStateFromDates(cfg, t("2026-10-16T07:00:00Z"))).toBe("not_started");
    expect(A.eventStateFromDates(cfg, t("2026-10-16T12:00:00Z"))).toBe("running");
    expect(A.eventStateFromDates({ ...cfg, paused: true }, t("2026-10-16T12:00:00Z"))).toBe("paused");
    expect(A.eventStateFromDates(cfg, t("2026-10-16T19:00:00Z"))).toBe("frozen");
    expect(A.eventStateFromDates(cfg, t("2026-10-16T21:00:00Z"))).toBe("ended");
  });
});

describe("adapter : API CTFd native", () => {
  it("liste des challenges : tags objets ou chaînes, difficulté par tag", () => {
    const list = A.toChallengeSummaries(
      {
        success: true,
        data: [
          { id: 1, type: "standard", name: "a", value: 10, solves: 3, solved_by_me: true, category: "web", tags: [{ value: "difficulty:hard" }] },
          { id: 2, type: "dynamic_instance", name: "b", value: 20, solves: null, solved_by_me: false, category: "pwn", tags: [] },
        ],
      },
      { attemptedIds: new Set([2]), myAccountId: 7 },
    );
    expect(list[0]).toMatchObject({ solvedByMe: true, difficulty: "hard", instanced: false });
    expect(list[1]).toMatchObject({ attempted: true, instanced: true, solves: 0 });
  });
  it("réécrit les fichiers vers le BFF sans exposer le token CTFd", () => {
    const d = A.toChallengeDetail(
      { success: true, data: { id: 5, name: "n", category: "c", value: 1, description: "d", files: ["/files/ab/dump.txt?token=SECRET"], hints: [{ id: 1, cost: 5 }] } },
      { attempted: false, myAccountId: null },
    );
    expect(d.files).toEqual([{ name: "dump.txt", href: "/api/files/5/0" }]);
    expect(JSON.stringify(d)).not.toContain("SECRET");
    expect(d.hints[0]).toMatchObject({ unlocked: false, content: null });
    expect(A.rawFileUrls({ data: { files: ["/files/ab/dump.txt?token=SECRET"] } })).toEqual(["/files/ab/dump.txt?token=SECRET"]);
  });
  it("scoreboard et séries cumulées", () => {
    expect(A.toScoreboard({ success: true, data: [{ pos: 1, account_id: 3, name: "blue", score: 300, members: [{}, {}] }] })[0]).toMatchObject({ memberCount: 2, score: 300 });
    const series = A.toScoreSeries({
      success: true,
      data: { "1": { id: 3, name: "blue", solves: [{ value: 100, date: "2026-10-16T09:00:00Z" }, { value: 50, date: "2026-10-16T08:00:00Z" }] } },
    });
    expect(series[0]?.points.map((p) => p.score)).toEqual([50, 150]);
  });
  it("place ordinale CTFd", () => {
    expect(A.parsePlace("3rd")).toBe(3);
    expect(A.parsePlace(4)).toBe(4);
    expect(A.parsePlace(null)).toBeNull();
  });
  it("messages d'erreur : message, errors objet ou liste", () => {
    expect(A.errorMessage({ message: "quota" })).toBe("quota");
    expect(A.errorMessage({ success: false, errors: { _: ["a", "b"] } })).toBe("a b");
    expect(A.errorMessage(null)).toBeNull();
    expect(A.errorDetails({ errors: { "challenge.yml": ["flags: requis", "value: requis"] } })).toEqual(["flags: requis", "value: requis"]);
    expect(A.errorDetails("html")).toEqual([]);
  });
  it("lève AdapterError sur une réponse inattendue", () => {
    expect(() => A.toMe({ success: true, data: { name: "sans id" } })).toThrow(A.AdapterError);
  });
});

describe("adapter : pad_public (first blood)", () => {
  const raw = {
    success: true,
    data: [
      { challenge_id: 12, account_id: 5, account_name: "blue", user_id: 2, user_name: "alice", date: "2026-10-16T08:00:00Z" },
      { challenge_id: 13, account_id: 9, account_name: "red", user_id: 3, user_name: null, date: "2026-10-16T09:00:00Z" },
    ],
  };
  it("indexe les first bloods par challenge", () => {
    const m = A.toFirstBloods(raw);
    expect(m.get(12)).toEqual({ accountId: 5, accountName: "blue", userName: "alice", date: "2026-10-16T08:00:00Z" });
    expect(m.get(13)?.userName).toBeNull();
    expect(m.has(14)).toBe(false);
    expect(A.toFirstBloods({ success: true, data: [] }).size).toBe(0);
  });
  it("les fusionne dans la liste et le détail (mine / other / aucun)", () => {
    const list = {
      success: true,
      data: [
        { id: 12, type: "standard", name: "a", value: 10, solves: 1, solved_by_me: false, category: "web", tags: [] },
        { id: 13, type: "standard", name: "b", value: 10, solves: 1, solved_by_me: false, category: "web", tags: [] },
        { id: 14, type: "standard", name: "c", value: 10, solves: 0, solved_by_me: false, category: "web", tags: [] },
      ],
    };
    const firstBloods = A.toFirstBloods(raw);
    const out = A.toChallengeSummaries(list, { attemptedIds: new Set(), myAccountId: 5, firstBloods });
    expect(out.map((c) => c.firstBlood)).toEqual(["mine", "other", null]);
    expect(out[0]?.firstBloodBy?.accountName).toBe("blue");
    expect(out[2]?.firstBloodBy).toBeNull();
    const detail = A.toChallengeDetail({ success: true, data: { ...list.data[1], description: "d" } }, { attempted: false, myAccountId: 5, firstBloods });
    expect(detail).toMatchObject({ firstBlood: "other", firstBloodBy: { accountName: "red" } });
    // Sans enrichissement (plugin indisponible) : aucun first blood, jamais d'erreur.
    expect(A.toChallengeSummaries(list, { attemptedIds: new Set(), myAccountId: 5 }).every((c) => c.firstBlood === null)).toBe(true);
  });
  it("l'événement des joueurs a le même format que celui des managers", () => {
    const e = A.toEventConfig({
      success: true,
      data: { start: 1760600000, end: 1760700000, freeze: 1760690000, paused: false, state: "frozen", server_time: 1760650000 },
    });
    expect(e).toMatchObject({ paused: false, state: "frozen" });
    expect(e.freeze).toBe(new Date(1760690000 * 1000).toISOString());
  });
});

describe("adapter : modération (manager_api)", () => {
  const meta = { page: 2, per_page: 50, total: 120, count: 1 };
  it("utilisateurs", () => {
    const p = A.toAdminUsers({
      success: true,
      data: [{ id: 2, name: "alice", email: "alice@example.org", type: "user", roles: ["manager"], team_id: 3, team_name: "blue", banned: false, hidden: true, created: "2026-10-16T08:00:00Z" }],
      meta,
    });
    expect(p).toMatchObject({ total: 120, page: 2, perPage: 50 });
    expect(p.items[0]).toEqual({ id: 2, name: "alice", email: "alice@example.org", teamId: 3, teamName: "blue", roles: ["manager"], banned: false, hidden: true });
  });
  it("équipes", () => {
    const p = A.toAdminTeams({ success: true, data: [{ id: 3, name: "blue", captain_id: 2, member_count: 4, banned: true, hidden: false }], meta });
    expect(p.items[0]).toEqual({ id: 3, name: "blue", memberCount: 4, banned: true, hidden: false });
  });
  it("soumissions et awards, sans meta (repli sur la taille de la page)", () => {
    const s = A.toAdminSubmissions({
      success: true,
      data: [{ id: 7, type: "correct", challenge_id: 1, challenge_name: "c1", user_id: 2, user_name: "alice", team_id: null, team_name: null, provided: "x", date: "2026-10-16T08:00:00Z" }],
    });
    expect(s.total).toBe(1);
    expect(s.items[0]).toMatchObject({ id: 7, challengeName: "c1", userName: "alice", teamName: null });
    const a = A.toAdminAwards({ success: true, data: [{ id: 1, name: "bonus", value: 50, user_name: "alice", team_name: null, date: "2026-10-16T08:00:00Z" }] });
    expect(a.items[0]).toMatchObject({ name: "bonus", value: 50 });
  });
  it("lève AdapterError sur une page malformée", () => {
    expect(() => A.toAdminUsers({ success: true, data: [{ name: "sans id" }] })).toThrow(A.AdapterError);
  });
});
