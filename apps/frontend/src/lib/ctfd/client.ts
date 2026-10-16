import "server-only";
import * as A from "./adapter";
import { logger } from "../logger";
import { CtfdError, ctfdFetch, ctfdJson } from "./http";
import { ssoHeaders } from "./sso";
import type {
  AdminAward,
  AdminSubmission,
  AdminTeam,
  AdminUser,
  AttemptResult,
  FirstBloodInfo,
  ModerationQuery,
  Page,
  ChallengeDetail,
  ChallengeStats,
  ChallengeSummary,
  EventConfig,
  ImportResult,
  Instance,
  ManagedChallenge,
  ManagedSummary,
  Me,
  Notification,
  ScoreSeries,
  ScoreboardEntry,
  Solve,
  SsoClaims,
  SsoSession,
  Team,
} from "./types";

export interface EventPatch {
  start?: string | null;
  end?: string | null;
  freeze?: string | null;
  paused?: boolean;
}

/**
 * Interface consommée par le reste du front. Le token CTFd est toujours passé explicitement
 * (jamais lu depuis un état global) et ne quitte jamais le serveur.
 */
export interface CtfdApi {
  // plugin sso_bridge
  createSession(claims: SsoClaims): Promise<SsoSession>;
  // joueur (API CTFd native)
  listChallenges(token: string): Promise<ChallengeSummary[]>;
  getChallenge(token: string, id: number): Promise<ChallengeDetail>;
  unlockHint(token: string, hintId: number): Promise<{ id: number; content: string }>;
  attempt(token: string, challengeId: number, submission: string): Promise<AttemptResult>;
  /** Flux d'un fichier de challenge (résolu côté serveur, le token de fichier CTFd ne sort pas). */
  fetchChallengeFile(token: string, challengeId: number, index: number): Promise<Response | null>;
  getScoreboard(token: string | null): Promise<ScoreboardEntry[]>;
  getTopSeries(token: string | null, n: number): Promise<ScoreSeries[]>;
  getMe(token: string): Promise<Me>;
  getMyTeam(token: string): Promise<Team | null>;
  getRecentSolves(token: string, teamId: number | null): Promise<Solve[]>;
  getNotifications(token: string | null, sinceId?: number): Promise<Notification[]>;
  // plugin pad_public (tout joueur authentifié)
  /** Événement lisible par les joueurs (`GET /api/v1/pad/event`). */
  getPublicEvent(token: string): Promise<EventConfig>;
  /** Premier solve par challenge visible (`GET /api/v1/pad/first-bloods`). */
  listFirstBloods(token: string): Promise<Map<number, FirstBloodInfo>>;
  // plugin pad_teams
  createTeam(token: string, input: { name: string; password: string }): Promise<void>;
  joinTeam(token: string, input: { name: string; password: string }): Promise<void>;
  leaveTeam(token: string): Promise<void>;
  // plugin chall_manager_bridge
  listInstances(token: string): Promise<Instance[]>;
  getInstance(token: string, challengeId: number): Promise<Instance | null>;
  startInstance(token: string, challengeId: number): Promise<Instance>;
  extendInstance(token: string, challengeId: number): Promise<Instance>;
  stopInstance(token: string, challengeId: number): Promise<void>;
  // plugin manager_api (rôle manager ou admin)
  listManagedChallenges(token: string): Promise<{ items: ManagedChallenge[]; summary: ManagedSummary }>;
  getChallengeStats(token: string, challengeId: number, bucket?: "hour" | "day"): Promise<ChallengeStats>;
  importChallenge(token: string, file: Blob, filename: string): Promise<ImportResult>;
  getEvent(token: string): Promise<EventConfig>;
  updateEvent(token: string, patch: EventPatch): Promise<EventConfig>;
  // modération (plugin manager_api, rôle manager ou admin ; chaque action est journalisée côté CTFd)
  listUsers(token: string, query?: ModerationQuery): Promise<Page<AdminUser>>;
  listTeams(token: string, query?: ModerationQuery): Promise<Page<AdminTeam>>;
  moderateUser(token: string, id: number, patch: ModerationPatch): Promise<void>;
  moderateTeam(token: string, id: number, patch: ModerationPatch): Promise<void>;
  listSubmissions(token: string, query?: ModerationQuery & { type?: string }): Promise<Page<AdminSubmission>>;
  invalidateSubmission(token: string, id: number): Promise<void>;
  listAwards(token: string, query?: ModerationQuery): Promise<Page<AdminAward>>;
  invalidateAward(token: string, id: number): Promise<void>;
}

export interface ModerationPatch {
  banned?: boolean;
  hidden?: boolean;
}

const SSO_PATH = "/api/v1/sso/session";

function pageQuery(q: ModerationQuery): Record<string, string | number | undefined> {
  return { page: q.page, per_page: q.perPage, q: q.q?.trim() || undefined };
}

export class HttpCtfdApi implements CtfdApi {
  constructor(private readonly ssoSecret: () => string) {}

  async createSession(claims: SsoClaims): Promise<SsoSession> {
    // Le corps est sérialisé une seule fois : la signature porte sur ces octets exacts.
    const body = JSON.stringify(claims);
    const raw = await ctfdJson({
      endpoint: "sso/session",
      path: SSO_PATH,
      method: "POST",
      rawBody: body,
      headers: ssoHeaders(this.ssoSecret(), { method: "POST", path: SSO_PATH, body }),
    });
    return A.toSsoSession(raw);
  }

  private async attemptedIds(token: string, teamId: number | null): Promise<Set<number>> {
    const path = teamId != null ? "/api/v1/teams/me/fails" : "/api/v1/users/me/fails";
    try {
      const raw = await ctfdJson({ endpoint: "fails", path, token });
      return new Set(A.toFails(raw).map((f) => f.challengeId));
    } catch {
      // Statut « tenté » non critique : on dégrade sans casser la grille.
      return new Set();
    }
  }

  /** First blood : enrichissement non critique, la grille s'affiche sans lui si le plugin est indisponible. */
  private async firstBloods(token: string): Promise<Map<number, FirstBloodInfo>> {
    try {
      return await this.listFirstBloods(token);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "first blood indisponible");
      return new Map();
    }
  }

  async listFirstBloods(token: string) {
    return A.toFirstBloods(await ctfdJson({ endpoint: "pad/first-bloods", path: "/api/v1/pad/first-bloods", token }));
  }

  async getPublicEvent(token: string) {
    return A.toEventConfig(await ctfdJson({ endpoint: "pad/event", path: "/api/v1/pad/event", token, timeoutMs: 3000 }));
  }

  async listChallenges(token: string) {
    const [raw, me, firstBloods] = await Promise.all([
      ctfdJson({ endpoint: "challenges", path: "/api/v1/challenges", token }),
      this.getMe(token),
      this.firstBloods(token),
    ]);
    const attemptedIds = await this.attemptedIds(token, me.teamId);
    return A.toChallengeSummaries(raw, { attemptedIds, myAccountId: me.teamId ?? me.id, firstBloods });
  }

  async getChallenge(token: string, id: number) {
    const [raw, me, firstBloods] = await Promise.all([
      ctfdJson({ endpoint: "challenges/:id", path: `/api/v1/challenges/${id}`, token }),
      this.getMe(token),
      this.firstBloods(token),
    ]);
    const attempted = (await this.attemptedIds(token, me.teamId)).has(id);
    return A.toChallengeDetail(raw, { attempted, myAccountId: me.teamId ?? me.id, firstBloods });
  }

  async unlockHint(token: string, hintId: number) {
    await ctfdJson({
      endpoint: "unlocks",
      path: "/api/v1/unlocks",
      method: "POST",
      token,
      json: { target: hintId, type: "hints" },
    });
    return A.toHint(await ctfdJson({ endpoint: "hints/:id", path: `/api/v1/hints/${hintId}`, token }));
  }

  async attempt(token: string, challengeId: number, submission: string) {
    // CTFd répond 403 (paused) et 429 (ratelimited) avec un corps exploitable.
    const raw = await ctfdJson(
      {
        endpoint: "challenges/attempt",
        path: "/api/v1/challenges/attempt",
        method: "POST",
        token,
        json: { challenge_id: challengeId, submission },
      },
      [403, 429],
    );
    return A.toAttemptResult(raw);
  }

  async fetchChallengeFile(token: string, challengeId: number, index: number) {
    const raw = await ctfdJson({ endpoint: "challenges/:id", path: `/api/v1/challenges/${challengeId}`, token });
    const url = A.rawFileUrls(raw)[index];
    if (!url) return null;
    const u = new URL(url, "http://ctfd.invalid");
    // Le token de fichier est un paramètre de la requête amont, il ne revient jamais au navigateur.
    return ctfdFetch({ endpoint: "files", path: u.pathname + u.search, token: null, headers: { Accept: "*/*" }, timeoutMs: 60_000 });
  }

  async getScoreboard(token: string | null) {
    return A.toScoreboard(await ctfdJson({ endpoint: "scoreboard", path: "/api/v1/scoreboard", token }));
  }

  async getTopSeries(token: string | null, n: number) {
    return A.toScoreSeries(await ctfdJson({ endpoint: "scoreboard/top", path: `/api/v1/scoreboard/top/${n}`, token }));
  }

  async getMe(token: string) {
    return A.toMe(await ctfdJson({ endpoint: "users/me", path: "/api/v1/users/me", token }));
  }

  async getMyTeam(token: string): Promise<Team | null> {
    let raw: unknown;
    try {
      raw = await ctfdJson({ endpoint: "teams/me", path: "/api/v1/teams/me", token });
    } catch (err) {
      if (err instanceof CtfdError && [400, 403, 404].includes(err.status)) return null;
      throw err;
    }
    const ids = A.teamMemberIds(raw);
    const members = await Promise.all(
      ids.map(async (uid) => A.toTeamMember(await ctfdJson({ endpoint: "users/:id", path: `/api/v1/users/${uid}`, token }))),
    );
    return A.toTeam(raw, members.sort((a, b) => b.score - a.score));
  }

  async getRecentSolves(token: string, teamId: number | null) {
    const path = teamId != null ? "/api/v1/teams/me/solves" : "/api/v1/users/me/solves";
    return A.toSolves(await ctfdJson({ endpoint: "solves", path, token }));
  }

  async getNotifications(token: string | null, sinceId?: number) {
    return A.toNotifications(
      await ctfdJson({ endpoint: "notifications", path: "/api/v1/notifications", token, query: { since_id: sinceId } }),
    );
  }

  async createTeam(token: string, input: { name: string; password: string }) {
    await ctfdJson({ endpoint: "pad/teams", path: "/api/v1/pad/teams", method: "POST", token, json: input });
  }

  async joinTeam(token: string, input: { name: string; password: string }) {
    await ctfdJson({ endpoint: "pad/teams/join", path: "/api/v1/pad/teams/join", method: "POST", token, json: input });
  }

  async leaveTeam(token: string) {
    await ctfdJson({ endpoint: "pad/teams/leave", path: "/api/v1/pad/teams/leave", method: "POST", token, json: {} });
  }

  async listInstances(token: string) {
    return A.toInstances(await ctfdJson({ endpoint: "instances", path: "/api/v1/instances", token, timeoutMs: 30_000 }));
  }

  async getInstance(token: string, challengeId: number) {
    try {
      return A.toInstance(
        await ctfdJson({ endpoint: "instances/:id", path: `/api/v1/instances/${challengeId}`, token, timeoutMs: 30_000 }),
      );
    } catch (err) {
      if (err instanceof CtfdError && err.status === 404) return null;
      throw err;
    }
  }

  async startInstance(token: string, challengeId: number) {
    return A.toInstance(
      await ctfdJson({ endpoint: "instances/:id", path: `/api/v1/instances/${challengeId}`, method: "POST", token, timeoutMs: 330_000 }),
    );
  }

  async extendInstance(token: string, challengeId: number) {
    return A.toInstance(
      await ctfdJson({ endpoint: "instances/:id", path: `/api/v1/instances/${challengeId}`, method: "PATCH", token, timeoutMs: 120_000 }),
    );
  }

  async stopInstance(token: string, challengeId: number) {
    await ctfdJson({ endpoint: "instances/:id", path: `/api/v1/instances/${challengeId}`, method: "DELETE", token, timeoutMs: 120_000 });
  }

  async listManagedChallenges(token: string) {
    return A.toManagedChallenges(await ctfdJson({ endpoint: "manager/challenges", path: "/api/v1/manager/challenges", token }));
  }

  async getChallengeStats(token: string, challengeId: number, bucket: "hour" | "day" = "hour") {
    return A.toChallengeStats(
      await ctfdJson({
        endpoint: "manager/stats",
        path: `/api/v1/manager/challenges/${challengeId}/stats`,
        token,
        query: { bucket },
      }),
    );
  }

  async importChallenge(token: string, file: Blob, filename: string) {
    const form = new FormData();
    form.set("file", file, filename);
    return A.toImportResult(
      await ctfdJson({
        endpoint: "manager/import",
        path: "/api/v1/manager/challenges/import",
        method: "POST",
        token,
        form,
        timeoutMs: 330_000, // import + téléversement Garage + enregistrement du scénario chall-manager
      }),
    );
  }

  async getEvent(token: string) {
    return A.toEventConfig(await ctfdJson({ endpoint: "manager/event", path: "/api/v1/manager/event", token }));
  }

  async updateEvent(token: string, patch: EventPatch) {
    const body: Record<string, unknown> = {};
    for (const k of ["start", "end", "freeze"] as const) {
      if (patch[k] !== undefined) body[k] = A.isoToEpoch(patch[k] ?? null);
    }
    if (patch.paused !== undefined) body.paused = patch.paused;
    return A.toEventConfig(
      await ctfdJson({ endpoint: "manager/event", path: "/api/v1/manager/event", method: "PATCH", token, json: body }),
    );
  }

  async listUsers(token: string, query: ModerationQuery = {}) {
    return A.toAdminUsers(
      await ctfdJson({ endpoint: "manager/users", path: "/api/v1/manager/users", token, query: pageQuery(query) }),
    );
  }

  async listTeams(token: string, query: ModerationQuery = {}) {
    return A.toAdminTeams(
      await ctfdJson({ endpoint: "manager/teams", path: "/api/v1/manager/teams", token, query: pageQuery(query) }),
    );
  }

  async moderateUser(token: string, id: number, patch: ModerationPatch) {
    await ctfdJson({ endpoint: "manager/users/:id", path: `/api/v1/manager/users/${id}`, method: "PATCH", token, json: patch });
  }

  async moderateTeam(token: string, id: number, patch: ModerationPatch) {
    await ctfdJson({ endpoint: "manager/teams/:id", path: `/api/v1/manager/teams/${id}`, method: "PATCH", token, json: patch });
  }

  async listSubmissions(token: string, query: ModerationQuery & { type?: string } = {}) {
    return A.toAdminSubmissions(
      await ctfdJson({
        endpoint: "manager/submissions",
        path: "/api/v1/manager/submissions",
        token,
        query: { ...pageQuery(query), type: query.type },
      }),
    );
  }

  async invalidateSubmission(token: string, id: number) {
    await ctfdJson({ endpoint: "manager/submissions/:id", path: `/api/v1/manager/submissions/${id}`, method: "DELETE", token });
  }

  async listAwards(token: string, query: ModerationQuery = {}) {
    return A.toAdminAwards(
      await ctfdJson({ endpoint: "manager/awards", path: "/api/v1/manager/awards", token, query: pageQuery(query) }),
    );
  }

  async invalidateAward(token: string, id: number) {
    await ctfdJson({ endpoint: "manager/awards/:id", path: `/api/v1/manager/awards/${id}`, method: "DELETE", token });
  }
}

const g = globalThis as unknown as { __padCtfd?: CtfdApi };

export function getCtfd(): CtfdApi {
  g.__padCtfd ??= new HttpCtfdApi(() => {
    const s = process.env.PAD_SSO_SHARED_SECRET;
    if (!s) throw new Error("PAD_SSO_SHARED_SECRET manquant");
    return s;
  });
  return g.__padCtfd;
}

export { CtfdError };
