/**
 * ADAPTATEUR UNIQUE entre l'API CTFd (+ plugins PAD) et les types internes du front.
 *
 * Toutes les hypothèses sur le format des réponses sont regroupées ici et validées par zod
 * (schémas permissifs : champs inconnus ignorés, champs optionnels tolérés). Si
 * `apps/ctfd/API.md` diverge, on corrige ce fichier et `src/mocks/fixtures.ts`, rien d'autre.
 */
import { z } from "zod";
import {
  DIFFICULTIES,
  EVENT_STATES,
  type AdminTeam,
  type AdminUser,
  type AttemptResult,
  type ChallengeDetail,
  type ChallengeStats,
  type ChallengeSummary,
  type Difficulty,
  type EventConfig,
  type EventState,
  type AdminAward,
  type AdminSubmission,
  type Fail,
  type FirstBlood,
  type FirstBloodInfo,
  type Page,
  type ImportResult,
  type Instance,
  type ManagedChallenge,
  type ManagedSummary,
  type Me,
  type Notification,
  type ScoreSeries,
  type ScoreboardEntry,
  type Solve,
  type SsoSession,
  type Team,
  type TeamMember,
} from "./types";

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly issues: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const res = schema.safeParse(raw);
  if (!res.success) {
    throw new AdapterError(`Réponse CTFd inattendue (${what})`, z.prettifyError(res.error));
  }
  return res.data;
}

/** Enveloppe standard CTFd : `{ success, data }`. */
export function envelope<T extends z.ZodType>(data: T) {
  return z.looseObject({ success: z.boolean().optional(), data });
}

const id = z.coerce.number().int();
const nullableStr = z.string().nullish().transform((v) => v ?? null);

// ---------------------------------------------------------------- plugin sso-bridge

const ssoSchema = z.looseObject({
  token: z.string().min(1),
  expires_at: z.string().nullish(),
  ttl: z.coerce.number().int().positive().default(900),
  user: z.looseObject({
    id,
    name: z.string(),
    email: nullableStr,
    type: z.string().default("user"),
    roles: z.array(z.string()).default([]),
    team_id: id.nullish(),
    team_name: nullableStr,
  }),
});

/** Rôle applicatif d'après `user.type` et `user.roles` (API.md, section 2). */
export function roleFromCtfd(type: string, roles: readonly string[]): SsoSession["role"] {
  if (type === "admin" || roles.includes("admin")) return "admin";
  if (roles.includes("manager")) return "manager";
  return "player";
}

/** `POST /api/v1/sso/session` : `{ success, data: { token, expires_at, ttl, user: {...} } }`. */
export function toSsoSession(raw: unknown, now: number = Date.now()): SsoSession {
  const r = parse(envelope(ssoSchema), raw, "sso/session").data;
  const parsedExpiry = r.expires_at ? Date.parse(r.expires_at) : Number.NaN;
  return {
    token: r.token,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : now + r.ttl * 1000,
    userId: r.user.id,
    name: r.user.name,
    email: r.user.email,
    teamId: r.user.team_id ?? null,
    teamName: r.user.team_name,
    role: roleFromCtfd(r.user.type, r.user.roles),
  };
}

// ---------------------------------------------------------------- challenges

/** Les tags arrivent en `["web"]` (détail) ou `[{ value: "web" }]` (liste). */
const tagsSchema = z
  .array(z.union([z.string(), z.looseObject({ value: z.string() })]))
  .nullish()
  .transform((tags) => (tags ?? []).map((t) => (typeof t === "string" ? t : t.value)));

/** Types de challenge considérés comme instanciés (chall-manager). */
export const INSTANCED_TYPES = new Set(["dynamic_instance"]);

/** Difficulté portée par un tag `difficulty:<niveau>` ou un tag nu `<niveau>`. */
export function difficultyFromTags(tags: readonly string[]): Difficulty | null {
  for (const raw of tags) {
    const t = raw.toLowerCase().trim();
    const value = t.startsWith("difficulty:") ? t.slice("difficulty:".length).trim() : t;
    if ((DIFFICULTIES as readonly string[]).includes(value)) return value as Difficulty;
  }
  return null;
}

const challengeListItem = z.looseObject({
  id,
  type: z.string().default("standard"),
  name: z.string(),
  value: z.coerce.number().default(0),
  solves: z.coerce.number().nullish(),
  solved_by_me: z.boolean().default(false),
  category: z.string().default("misc"),
  tags: tagsSchema,
  instance: z.unknown().optional(),
});

const firstBloodRow = z.looseObject({
  challenge_id: id,
  account_id: id,
  account_name: z.string().default("?"),
  user_name: z.string().nullish(),
  date: z.string(),
});

/**
 * `GET /api/v1/pad/first-bloods` (plugin pad_public) : `{ success, data: [{ challenge_id,
 * account_id, account_name, user_id, user_name, date }] }`. L'API native de CTFd n'expose pas
 * le first blood : il est fusionné ici, challenge par challenge.
 */
export function toFirstBloods(raw: unknown): Map<number, FirstBloodInfo> {
  const rows = parse(envelope(z.array(firstBloodRow)), raw, "pad/first-bloods").data;
  return new Map(
    rows.map((r) => [
      r.challenge_id,
      { accountId: r.account_id, accountName: r.account_name, userName: r.user_name ?? null, date: r.date },
    ]),
  );
}

type FirstBloods = ReadonlyMap<number, FirstBloodInfo>;

function firstBloodOf(
  challengeId: number,
  firstBloods: FirstBloods | undefined,
  myAccountId: number | null,
): { firstBlood: FirstBlood; firstBloodBy: FirstBloodInfo | null } {
  const by = firstBloods?.get(challengeId) ?? null;
  if (!by) return { firstBlood: null, firstBloodBy: null };
  return { firstBlood: myAccountId != null && by.accountId === myAccountId ? "mine" : "other", firstBloodBy: by };
}

export function toChallengeSummaries(
  raw: unknown,
  ctx: { attemptedIds: ReadonlySet<number>; myAccountId: number | null; firstBloods?: FirstBloods },
): ChallengeSummary[] {
  const list = parse(envelope(z.array(challengeListItem)), raw, "challenges").data;
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    solves: c.solves ?? 0,
    solvedByMe: c.solved_by_me,
    attempted: !c.solved_by_me && ctx.attemptedIds.has(c.id),
    ...firstBloodOf(c.id, ctx.firstBloods, ctx.myAccountId),
    difficulty: difficultyFromTags(c.tags),
    tags: c.tags,
    instanced: INSTANCED_TYPES.has(c.type) || Boolean(c.instance),
  }));
}

const hintSchema = z.looseObject({
  id,
  cost: z.coerce.number().default(0),
  content: z.string().nullish(),
});

/** Nom d'un fichier à partir de son URL CTFd (`/files/<hash>/<nom>?token=...`). */
export function fileName(url: string): string {
  const u = new URL(url, "http://ctfd.invalid");
  return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "fichier");
}

/**
 * Les URLs de fichiers CTFd portent un token : on ne les expose jamais. Le navigateur reçoit
 * `/api/files/<challenge>/<index>`, que le BFF résout côté serveur.
 */
export function toFileRef(url: string, challengeId: number, index: number): { name: string; href: string } {
  return { name: fileName(url), href: `/api/files/${challengeId}/${index}` };
}

/** URLs brutes des fichiers d'un challenge (usage serveur uniquement). */
export function rawFileUrls(raw: unknown): string[] {
  return parse(envelope(z.looseObject({ files: z.array(z.string()).default([]) })), raw, "challenge files").data.files;
}

const challengeDetail = challengeListItem.extend({
  description: z.string().default(""),
  connection_info: nullableStr,
  max_attempts: z.coerce.number().default(0),
  attempts: z.coerce.number().default(0),
  files: z.array(z.string()).default([]),
  hints: z.array(hintSchema).default([]),
});

export function toChallengeDetail(
  raw: unknown,
  ctx: { attempted: boolean; myAccountId: number | null; unlockedHintIds?: ReadonlySet<number>; firstBloods?: FirstBloods },
): ChallengeDetail {
  const c = parse(envelope(challengeDetail), raw, "challenge").data;
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    solves: c.solves ?? 0,
    solvedByMe: c.solved_by_me,
    attempted: !c.solved_by_me && (ctx.attempted || c.attempts > 0),
    ...firstBloodOf(c.id, ctx.firstBloods, ctx.myAccountId),
    difficulty: difficultyFromTags(c.tags),
    tags: c.tags,
    instanced: INSTANCED_TYPES.has(c.type) || Boolean(c.instance),
    description: c.description,
    connectionInfo: c.connection_info,
    maxAttempts: c.max_attempts,
    attempts: c.attempts,
    files: c.files.map((u, i) => toFileRef(u, c.id, i)),
    hints: c.hints.map((h) => ({
      id: h.id,
      cost: h.cost,
      content: h.content ?? null,
      unlocked: h.content != null || (ctx.unlockedHintIds?.has(h.id) ?? false),
    })),
  };
}

export function toHint(raw: unknown): { id: number; content: string } {
  const h = parse(envelope(z.looseObject({ id, content: z.string() })), raw, "hint").data;
  return { id: h.id, content: h.content };
}

const ATTEMPT_STATUSES = ["correct", "incorrect", "already_solved", "paused", "ratelimited"] as const;

export function toAttemptResult(raw: unknown): AttemptResult {
  const d = parse(
    envelope(z.looseObject({ status: z.enum(ATTEMPT_STATUSES), message: z.string().default("") })),
    raw,
    "attempt",
  ).data;
  return { status: d.status, message: d.message };
}

// ---------------------------------------------------------------- scoreboard

const scoreboardRow = z.looseObject({
  pos: z.coerce.number(),
  account_id: id,
  name: z.string(),
  score: z.coerce.number().default(0),
  members: z.array(z.unknown()).nullish(),
});

export function toScoreboard(raw: unknown): ScoreboardEntry[] {
  return parse(envelope(z.array(scoreboardRow)), raw, "scoreboard").data.map((r) => ({
    pos: r.pos,
    accountId: r.account_id,
    name: r.name,
    score: r.score,
    memberCount: r.members?.length ?? 1,
  }));
}

const topSolve = z.looseObject({ value: z.coerce.number(), date: z.string() });
const topEntry = z.looseObject({ id, name: z.string(), solves: z.array(topSolve).default([]) });

/** `/scoreboard/top/{n}` : `{ "1": { id, name, solves[] }, ... }` -> séries cumulées triées par rang. */
export function toScoreSeries(raw: unknown): ScoreSeries[] {
  const data = parse(envelope(z.record(z.string(), topEntry)), raw, "scoreboard/top").data;
  return Object.entries(data)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, e]) => {
      let total = 0;
      const points = [...e.solves]
        .map((s) => ({ t: Date.parse(s.date), value: s.value }))
        .filter((s) => Number.isFinite(s.t))
        .sort((a, b) => a.t - b.t)
        .map((s) => ({ t: s.t, score: (total += s.value) }));
      return { accountId: e.id, name: e.name, points };
    });
}

// ---------------------------------------------------------------- comptes et équipes

/** CTFd renvoie `place` sous forme ordinale anglaise ("1st") ou de nombre. */
export function parsePlace(place: unknown): number | null {
  if (typeof place === "number") return place;
  if (typeof place !== "string") return null;
  const n = Number.parseInt(place, 10);
  return Number.isFinite(n) ? n : null;
}

const meSchema = z.looseObject({
  id,
  name: z.string(),
  email: nullableStr,
  team_id: id.nullish(),
  score: z.coerce.number().nullish(),
  place: z.unknown().optional(),
  affiliation: nullableStr,
  country: nullableStr,
});

export function toMe(raw: unknown): Me {
  const u = parse(envelope(meSchema), raw, "users/me").data;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    teamId: u.team_id ?? null,
    score: u.score ?? 0,
    place: parsePlace(u.place),
    affiliation: u.affiliation,
    country: u.country,
  };
}

const teamSchema = z.looseObject({
  id,
  name: z.string(),
  score: z.coerce.number().nullish(),
  place: z.unknown().optional(),
  captain_id: id.nullish(),
  members: z.array(z.union([id, z.looseObject({ id })])).default([]),
});

/** Ids des membres d'une équipe (liste d'ids ou d'objets selon la version de CTFd). */
export function teamMemberIds(raw: unknown): number[] {
  const t = parse(envelope(teamSchema), raw, "teams/me").data;
  return t.members.map((m) => (typeof m === "number" ? m : m.id));
}

export function toTeam(raw: unknown, members: TeamMember[]): Team {
  const t = parse(envelope(teamSchema), raw, "teams/me").data;
  return {
    id: t.id,
    name: t.name,
    score: t.score ?? 0,
    place: parsePlace(t.place),
    captainId: t.captain_id ?? null,
    members,
  };
}

export function toTeamMember(raw: unknown): TeamMember {
  const u = parse(envelope(z.looseObject({ id, name: z.string(), score: z.coerce.number().nullish() })), raw, "user").data;
  return { id: u.id, name: u.name, score: u.score ?? 0 };
}

const solveSchema = z.looseObject({
  challenge_id: id,
  challenge: z.looseObject({ name: z.string(), category: z.string().default("misc"), value: z.coerce.number().default(0) }).nullish(),
  user: z.looseObject({ name: z.string() }).nullish(),
  date: z.string(),
});

export function toSolves(raw: unknown): Solve[] {
  return parse(envelope(z.array(solveSchema)), raw, "solves")
    .data.map((s) => ({
      challengeId: s.challenge_id,
      challengeName: s.challenge?.name ?? `#${s.challenge_id}`,
      category: s.challenge?.category ?? "misc",
      value: s.challenge?.value ?? 0,
      date: s.date,
      userName: s.user?.name ?? null,
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function toFails(raw: unknown): Fail[] {
  return parse(envelope(z.array(z.looseObject({ challenge_id: id, date: z.string() }))), raw, "fails").data.map(
    (f) => ({ challengeId: f.challenge_id, date: f.date }),
  );
}

// ---------------------------------------------------------------- notifications

export function toNotifications(raw: unknown): Notification[] {
  return parse(
    envelope(z.array(z.looseObject({ id, title: z.string().default(""), content: z.string().default(""), date: z.string() }))),
    raw,
    "notifications",
  )
    .data.map((n) => ({ id: n.id, title: n.title, content: n.content, date: n.date }))
    .sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------- plugin instances (chall_manager_bridge)

/** chall-manager renvoie des dates à la nanoseconde (`...:00.123456789Z`) : on tronque à la milliseconde. */
export function normalizeIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/(\.\d{3})\d+/, "$1");
  return Number.isFinite(Date.parse(s)) ? s : null;
}

const instanceSchema = z.looseObject({
  challenge_id: id,
  source_id: nullableStr,
  connection_info: nullableStr,
  since: nullableStr,
  last_renew: nullableStr,
  until: nullableStr,
  expires_in: z.coerce.number().nullish(),
  renewals: z.coerce.number().default(0),
  max_renewals: z.coerce.number().nullish(),
  renewals_left: z.coerce.number().nullish(),
  per_instance_flag: z.boolean().default(false),
});

function mapInstance(i: z.infer<typeof instanceSchema>): Instance {
  return {
    challengeId: i.challenge_id,
    sourceId: i.source_id,
    connectionInfo: i.connection_info,
    since: normalizeIso(i.since),
    lastRenew: normalizeIso(i.last_renew),
    until: normalizeIso(i.until),
    expiresIn: i.expires_in ?? null,
    renewals: i.renewals,
    maxRenewals: i.max_renewals ?? null,
    renewalsLeft: i.renewals_left ?? null,
    perInstanceFlag: i.per_instance_flag,
  };
}

/** `GET|POST|PATCH /api/v1/instances/<id>` : `{ success, data: Instance }`. */
export function toInstance(raw: unknown): Instance {
  return mapInstance(parse(envelope(instanceSchema), raw, "instance").data);
}

/** `GET /api/v1/instances` : `{ success, data: Instance[] }`. */
export function toInstances(raw: unknown): Instance[] {
  return parse(envelope(z.array(instanceSchema)), raw, "instances").data.map(mapInstance);
}

// ---------------------------------------------------------------- portail manager (plugin manager_api)

const managedChallenge = z.looseObject({
  id,
  name: z.string(),
  category: z.string().default("misc"),
  type: z.string().default("standard"),
  state: z.string().default("hidden"),
  value: z.coerce.number().default(0),
  instance: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  solves: z.coerce.number().default(0),
  attempts: z.coerce.number().default(0),
  success_rate: z.coerce.number().default(0),
});

const managedList = z.looseObject({
  success: z.boolean().optional(),
  data: z.array(managedChallenge),
  meta: z
    .looseObject({
      count: z.coerce.number().default(0),
      solves: z.coerce.number().default(0),
      attempts: z.coerce.number().default(0),
      success_rate: z.coerce.number().default(0),
    })
    .optional(),
});

/** `GET /api/v1/manager/challenges` : liste (tous états) et agrégats. */
export function toManagedChallenges(raw: unknown): { items: ManagedChallenge[]; summary: ManagedSummary } {
  const r = parse(managedList, raw, "manager/challenges");
  const items = r.data.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    type: c.type,
    state: c.state,
    instanced: c.instance || INSTANCED_TYPES.has(c.type),
    tags: c.tags,
    solves: c.solves,
    attempts: c.attempts,
    successRate: c.success_rate,
  }));
  const m = r.meta;
  return {
    items,
    summary: {
      count: m?.count ?? items.length,
      solves: m?.solves ?? items.reduce((n, c) => n + c.solves, 0),
      attempts: m?.attempts ?? items.reduce((n, c) => n + c.attempts, 0),
      successRate: m?.success_rate ?? 0,
    },
  };
}

const statsSchema = managedChallenge.extend({
  incorrect_attempts: z.coerce.number().default(0),
  first_blood: z
    .looseObject({
      account_name: z.string().nullish(),
      user_name: z.string().nullish(),
      date: z.string(),
    })
    .nullish(),
  bucket: z.enum(["hour", "day"]).default("hour"),
  solves_over_time: z
    .array(z.looseObject({ t: z.string(), solves: z.coerce.number(), cumulative: z.coerce.number() }))
    .default([]),
});

/** `GET /api/v1/manager/challenges/<id>/stats`. */
export function toChallengeStats(raw: unknown): ChallengeStats {
  const s = parse(envelope(statsSchema), raw, "manager/stats").data;
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    type: s.type,
    state: s.state,
    value: s.value,
    solves: s.solves,
    attempts: s.attempts,
    incorrectAttempts: s.incorrect_attempts,
    successRate: s.success_rate,
    firstBlood: s.first_blood
      ? { accountName: s.first_blood.account_name ?? "?", userName: s.first_blood.user_name ?? null, date: s.first_blood.date }
      : null,
    bucket: s.bucket,
    solvesOverTime: s.solves_over_time,
  };
}

const importSchema = z.looseObject({
  id,
  name: z.string(),
  action: z.enum(["created", "updated"]),
  type: z.string().default("standard"),
  state: z.string().default("hidden"),
  value: z.coerce.number().default(0),
  instance: z.boolean().default(false),
  flags: z.coerce.number().default(0),
  hints: z.coerce.number().default(0),
  tags: z.coerce.number().default(0),
  files: z.array(z.string()).default([]),
  files_uploaded: z.array(z.string()).default([]),
});

/** `POST /api/v1/manager/challenges/import` (201 créé, 200 mis à jour). */
export function toImportResult(raw: unknown): ImportResult {
  const r = parse(envelope(importSchema), raw, "manager/import").data;
  return {
    id: r.id,
    name: r.name,
    action: r.action,
    type: r.type,
    state: r.state,
    value: r.value,
    instance: r.instance,
    flags: r.flags,
    hints: r.hints,
    tags: r.tags,
    files: r.files,
    filesUploaded: r.files_uploaded,
  };
}

/** Dates de l'événement : secondes epoch (entier) ou `null`. */
export function epochToIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

export function isoToEpoch(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

const eventSchema = z.looseObject({
  start: z.unknown().optional(),
  end: z.unknown().optional(),
  freeze: z.unknown().optional(),
  paused: z.boolean().default(false),
  state: z.enum(EVENT_STATES).default("running"),
});

/** `GET|PATCH /api/v1/manager/event`. */
export function toEventConfig(raw: unknown): EventConfig {
  const e = parse(envelope(eventSchema), raw, "manager/event").data;
  return {
    start: epochToIso(e.start),
    end: epochToIso(e.end),
    freeze: epochToIso(e.freeze),
    paused: e.paused,
    state: e.state,
  };
}

/** Phase de l'événement déduite des dates (repli lorsque l'API manager n'est pas accessible). */
export function eventStateFromDates(
  cfg: { start: string | null; end: string | null; freeze: string | null; paused?: boolean },
  now: number = Date.now(),
): EventState {
  const at = (v: string | null) => (v ? Date.parse(v) : Number.NaN);
  const start = at(cfg.start);
  const end = at(cfg.end);
  const freeze = at(cfg.freeze);
  if (Number.isFinite(end) && now >= end) return "ended";
  if (Number.isFinite(start) && now < start) return "not_started";
  if (cfg.paused) return "paused";
  if (Number.isFinite(freeze) && now >= freeze) return "frozen";
  return "running";
}

// ---------------------------------------------------------------- modération (plugin manager_api)

const pageMeta = z.looseObject({
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(50),
  total: z.coerce.number().optional(),
});

/** Enveloppe paginée `{ success, data: [...], meta: { page, per_page, total, count } }`. */
function paged<T extends z.ZodType>(row: T) {
  return z.looseObject({ success: z.boolean().optional(), data: z.array(row), meta: pageMeta.optional() });
}

function toPage<R, T>(r: { data: R[]; meta?: z.infer<typeof pageMeta> }, map: (row: R) => T): Page<T> {
  const items = r.data.map(map);
  return { items, total: r.meta?.total ?? items.length, page: r.meta?.page ?? 1, perPage: r.meta?.per_page ?? items.length };
}

const moderationFlags = { banned: z.boolean().default(false), hidden: z.boolean().default(false) };

/** `GET /api/v1/manager/users`. */
export function toAdminUsers(raw: unknown): Page<AdminUser> {
  const row = z.looseObject({
    id,
    name: z.string(),
    email: nullableStr,
    team_id: id.nullish(),
    team_name: nullableStr,
    roles: z.array(z.string()).default([]),
    ...moderationFlags,
  });
  return toPage(parse(paged(row), raw, "manager/users"), (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    teamId: u.team_id ?? null,
    teamName: u.team_name,
    roles: u.roles,
    banned: u.banned,
    hidden: u.hidden,
  }));
}

/** `GET /api/v1/manager/teams`. */
export function toAdminTeams(raw: unknown): Page<AdminTeam> {
  const row = z.looseObject({ id, name: z.string(), member_count: z.coerce.number().default(0), ...moderationFlags });
  return toPage(parse(paged(row), raw, "manager/teams"), (t) => ({
    id: t.id,
    name: t.name,
    memberCount: t.member_count,
    banned: t.banned,
    hidden: t.hidden,
  }));
}

/** `GET /api/v1/manager/submissions`. */
export function toAdminSubmissions(raw: unknown): Page<AdminSubmission> {
  const row = z.looseObject({
    id,
    type: z.string(),
    challenge_id: id.nullish(),
    challenge_name: nullableStr,
    user_name: nullableStr,
    team_name: nullableStr,
    date: z.string(),
  });
  return toPage(parse(paged(row), raw, "manager/submissions"), (s) => ({
    id: s.id,
    type: s.type,
    challengeId: s.challenge_id ?? null,
    challengeName: s.challenge_name,
    userName: s.user_name,
    teamName: s.team_name,
    date: s.date,
  }));
}

/** `GET /api/v1/manager/awards`. */
export function toAdminAwards(raw: unknown): Page<AdminAward> {
  const row = z.looseObject({
    id,
    name: nullableStr,
    value: z.coerce.number().default(0),
    user_name: nullableStr,
    team_name: nullableStr,
    date: z.string(),
  });
  return toPage(parse(paged(row), raw, "manager/awards"), (a) => ({
    id: a.id,
    name: a.name ?? "(sans nom)",
    value: a.value,
    userName: a.user_name,
    teamName: a.team_name,
    date: a.date,
  }));
}

/** Détails d'erreur de validation (`errors["challenge.yml"]`, etc.) aplatis en lignes lisibles. */
export function errorDetails(raw: unknown): string[] {
  const r = z
    .looseObject({ errors: z.union([z.record(z.string(), z.union([z.string(), z.array(z.string())])), z.array(z.string())]).optional() })
    .safeParse(raw);
  if (!r.success || !r.data.errors) return [];
  const e = r.data.errors;
  if (Array.isArray(e)) return e;
  return Object.values(e).flat();
}

/** Extrait un message d'erreur lisible d'une réponse d'erreur CTFd (`errors` ou `message`). */
export function errorMessage(raw: unknown): string | null {
  const r = z
    .looseObject({
      message: z.string().optional(),
      errors: z.union([z.record(z.string(), z.union([z.string(), z.array(z.string())])), z.array(z.string())]).optional(),
    })
    .safeParse(raw);
  if (!r.success) return null;
  if (r.data.message) return r.data.message;
  const e = r.data.errors;
  if (!e) return null;
  const parts = Array.isArray(e) ? e : Object.values(e).flat();
  return parts.join(" ") || null;
}
