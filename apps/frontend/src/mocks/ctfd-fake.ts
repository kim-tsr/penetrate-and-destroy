/**
 * CTFd simulé en mémoire, conforme à apps/ctfd/API.md (sso_bridge, chall_manager_bridge, pad_teams,
 * manager_api et le sous-ensemble natif utilisé par le front).
 *
 * Utilisé par :
 *  - le mode `PAD_MOCK=1` (jamais en production) : `ctfdFetch` appelle `fakeCtfd()` au lieu de `fetch` ;
 *  - les tests unitaires, via les handlers msw de `handlers.ts`.
 *
 * L'état vit sur `globalThis` (survit au rechargement à chaud) ; `resetFakeCtfd()` le réinitialise.
 */
import { inspectChallengeZip } from "../lib/challenge-yml/parse-zip";
import { verifySso } from "../lib/ctfd/sso";
import { roleFromGroups } from "../lib/roles";

type Role = "player" | "manager" | "admin";

interface FakeUser {
  id: number;
  sub: string;
  name: string;
  email: string;
  role: Role;
  teamId: number | null;
  banned: boolean;
  hidden: boolean;
}
interface FakeTeam {
  id: number;
  name: string;
  password: string;
  captainId: number | null;
  banned: boolean;
  hidden: boolean;
}
interface FakeChallenge {
  id: number;
  name: string;
  category: string;
  type: "standard" | "dynamic_instance";
  state: "visible" | "hidden";
  value: number;
  description: string;
  tags: string[];
  flags: string[];
  hints: { id: number; cost: number; content: string }[];
  files: string[];
  connectionInfo: string | null;
  maxAttempts: number;
  ttl: number;
}
interface FakeSolve {
  id: number;
  challengeId: number;
  userId: number;
  teamId: number | null;
  date: string;
}
interface FakeFail {
  id: number;
  challengeId: number;
  userId: number;
  teamId: number | null;
  date: string;
}
interface FakeInstance {
  challengeId: number;
  source: string;
  since: number;
  lastRenew: number;
  until: number;
  renewals: number;
  port: number;
}
interface FakeState {
  seq: { user: number; team: number; challenge: number; hint: number; notification: number; port: number; submission: number; award: number };
  users: FakeUser[];
  teams: FakeTeam[];
  challenges: FakeChallenge[];
  solves: FakeSolve[];
  fails: FakeFail[];
  awards: { id: number; name: string; value: number; userId: number; teamId: number | null; date: string }[];
  unlocked: { userId: number; hintId: number }[];
  instances: FakeInstance[];
  notifications: { id: number; title: string; content: string; date: string }[];
  tokens: Map<string, { userId: number; exp: number }>;
  nonces: Map<string, number>;
  event: { start: number | null; end: number | null; freeze: number | null; paused: boolean };
}

const g = globalThis as unknown as { __padFakeCtfd?: FakeState };

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seed(): FakeState {
  const now = Date.now();
  const s: FakeState = {
    seq: { user: 0, team: 0, challenge: 0, hint: 0, notification: 0, port: 0, submission: 0, award: 0 },
    users: [],
    teams: [],
    challenges: [],
    solves: [],
    fails: [],
    awards: [],
    unlocked: [],
    instances: [],
    notifications: [],
    tokens: new Map(),
    nonces: new Map(),
    event: { start: Math.floor((now - 3 * 3600_000) / 1000), end: Math.floor((now + 21 * 3600_000) / 1000), freeze: null, paused: false },
  };
  const addChallenge = (c: Omit<FakeChallenge, "id" | "hints"> & { hints?: { cost: number; content: string }[] }) => {
    s.challenges.push({ ...c, id: ++s.seq.challenge, hints: (c.hints ?? []).map((h) => ({ ...h, id: ++s.seq.hint })) });
  };
  addChallenge({
    name: "Hello Operator",
    category: "misc",
    type: "standard",
    state: "visible",
    value: 50,
    description: "Bienvenue dans la salle d'opérations.\n\nLe flag est au format `PAD{...}` : **hello_operator**.",
    tags: ["difficulty:easy", "warmup"],
    flags: ["PAD{hello_operator}"],
    files: [],
    connectionInfo: null,
    maxAttempts: 0,
    ttl: 0,
  });
  addChallenge({
    name: "Caesar's Console",
    category: "crypto",
    type: "standard",
    state: "visible",
    value: 100,
    description: "Un message intercepté : `CNQ{ebg13_vf_abg_pelcgb}`. Rien de bien sorcier.",
    tags: ["difficulty:easy"],
    flags: ["PAD{rot13_is_not_crypto}"],
    hints: [{ cost: 10, content: "Le décalage est de 13." }],
    files: [],
    connectionInfo: null,
    maxAttempts: 0,
    ttl: 0,
  });
  addChallenge({
    name: "Portail Admin",
    category: "web",
    type: "dynamic_instance",
    state: "visible",
    value: 200,
    description: "Le portail interne protège un secret derrière un login. Retrouvez-le.\n\nUne instance dédiée est lancée pour votre équipe.",
    tags: ["difficulty:medium", "sqli"],
    flags: ["PAD{sqli_union_or_bypass_ftw}"],
    hints: [{ cost: 25, content: "Le formulaire concatène vos entrées dans la requête SQL." }],
    files: [],
    connectionInfo: "Instance dédiée par équipe (HTTP).",
    maxAttempts: 0,
    ttl: 30 * 60,
  });
  addChallenge({
    name: "ret2win",
    category: "pwn",
    type: "dynamic_instance",
    state: "visible",
    value: 300,
    description: "Un dépassement de tampon classique. Appelez `win()`.",
    tags: ["difficulty:hard"],
    flags: ["PAD{ret2win_ez}"],
    files: ["ret2win.c"],
    connectionInfo: null,
    maxAttempts: 0,
    ttl: 30 * 60,
  });
  addChallenge({
    name: "Memory Lane",
    category: "forensics",
    type: "standard",
    state: "visible",
    value: 250,
    description: "Une capture mémoire partielle vous attend dans `dump.txt`.",
    tags: ["difficulty:medium"],
    flags: ["PAD{volatility_who}"],
    files: ["dump.txt"],
    connectionInfo: null,
    maxAttempts: 5,
    ttl: 0,
  });
  addChallenge({
    name: "Backstage",
    category: "misc",
    type: "standard",
    state: "hidden",
    value: 500,
    description: "Pas encore publié.",
    tags: ["difficulty:insane"],
    flags: ["PAD{backstage}"],
    files: [],
    connectionInfo: null,
    maxAttempts: 0,
    ttl: 0,
  });

  const team = (name: string, password: string) => {
    const t: FakeTeam = { id: ++s.seq.team, name, password, captainId: null, banned: false, hidden: false };
    s.teams.push(t);
    return t;
  };
  const user = (name: string, role: Role, t?: FakeTeam) => {
    const u: FakeUser = {
      id: ++s.seq.user,
      sub: `mock-${name}`,
      name,
      email: `${name}@mock.pad.example`,
      role,
      teamId: t?.id ?? null,
      banned: false,
      hidden: role !== "player",
      };
    s.users.push(u);
    if (t && t.captainId == null) t.captainId = u.id;
    return u;
  };
  const red = team("Red Pandas", "red-pandas-secret");
  const blue = team("Blue Foxes", "blue-foxes-secret");
  const nul = team("Null Pointers", "null-pointers-secret");
  const ada = user("ada", "player", red);
  const bob = user("bob", "player", blue);
  const eve = user("eve", "player", nul);
  const solve = (u: FakeUser, challengeId: number, minutesAgo: number) =>
    s.solves.push({ id: ++s.seq.submission, challengeId, userId: u.id, teamId: u.teamId, date: iso(now - minutesAgo * MIN) });
  solve(ada, 1, 150);
  solve(ada, 2, 120);
  solve(bob, 1, 140);
  solve(bob, 3, 90);
  solve(eve, 1, 100);
  solve(eve, 5, 40);
  s.notifications.push({
    id: ++s.seq.notification,
    title: "Ouverture des opérations",
    content: "Le CTF est ouvert. Rappel : les instances ne sont joignables qu'**via NetBird**.",
    date: iso(now - 3 * 3600_000),
  });
  return s;
}

function state(): FakeState {
  g.__padFakeCtfd ??= seed();
  return g.__padFakeCtfd;
}

export function resetFakeCtfd(): void {
  g.__padFakeCtfd = seed();
}

/** Accès direct à l'état (tests et e2e uniquement). */
export function fakeState(): FakeState {
  return state();
}

// ------------------------------------------------------------------ helpers HTTP

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const ok = (data: unknown, status = 200, extra: Record<string, unknown> = {}) => json(status, { success: true, data, ...extra });
const err = (status: number, message: string) => json(status, { success: false, errors: { _: [message] } });
const msg = (status: number, message: string) => json(status, { message });

const ordinal = (n: number) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

// ------------------------------------------------------------------ scoring

function accountOf(u: FakeUser) {
  const t = u.teamId != null ? state().teams.find((x) => x.id === u.teamId) : undefined;
  return { id: t ? t.id : u.id, name: t ? t.name : u.name, isTeam: !!t };
}

/** Clé de compte : équipe (`t<id>`) ou joueur seul (`u<id>`), pour éviter toute collision d'identifiants. */
function solveKey(x: { teamId: number | null; userId: number }): string {
  return x.teamId != null ? `t${x.teamId}` : `u${x.userId}`;
}
function userKey(u: FakeUser): string {
  return solveKey({ teamId: u.teamId, userId: u.id });
}

function valueOf(challengeId: number): number {
  return state().challenges.find((c) => c.id === challengeId)?.value ?? 0;
}

function ranking() {
  const s = state();
  const scores = new Map<string, { id: number; name: string; score: number; isTeam: boolean; members: number }>();
  for (const sv of s.solves) {
    const u = s.users.find((x) => x.id === sv.userId);
    if (!u || u.banned || u.hidden) continue;
    const acc = accountOf(u);
    const t = acc.isTeam ? s.teams.find((x) => x.id === acc.id) : undefined;
    if (t && (t.banned || t.hidden)) continue;
    const key = `${acc.isTeam ? "t" : "u"}${acc.id}`;
    const cur = scores.get(key) ?? {
      id: acc.id,
      name: acc.name,
      score: 0,
      isTeam: acc.isTeam,
      members: acc.isTeam ? s.users.filter((x) => x.teamId === acc.id).length : 1,
    };
    cur.score += valueOf(sv.challengeId);
    scores.set(key, cur);
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function placeOf(accountId: number, isTeam: boolean): number | null {
  const idx = ranking().findIndex((r) => r.id === accountId && r.isTeam === isTeam);
  return idx === -1 ? null : idx + 1;
}

// ------------------------------------------------------------------ routeur

type Ctx = { req: Request; url: URL; path: string; user: FakeUser | null; body: () => Promise<unknown> };

export async function fakeCtfd(req: Request): Promise<Response> {
  const s = state();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/api/v1/sso/session" && method === "POST") return ssoSession(req, path);
  if (path === "/healthcheck") return new Response("OK");

  const auth = req.headers.get("authorization");
  const tokenValue = auth?.startsWith("Token ") ? auth.slice(6) : null;
  const t = tokenValue ? s.tokens.get(tokenValue) : undefined;
  // CTFd 3.8 : l'API NATIVE n'authentifie un `Authorization: Token` que pour une requête JSON
  // (`request.is_json`) ; sinon redirection 302 vers /login. Les plugins pad_* appellent
  // `ensure_token_login()` et acceptent le token sans Content-Type (API.md, section 1.1).
  const pluginPath = /^\/api\/v1\/(manager|instances|pad)(\/|$)/.test(path);
  const isJson = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
  const user =
    t && t.exp > Date.now() && (pluginPath || isJson) ? (s.users.find((u) => u.id === t.userId) ?? null) : null;
  if (tokenValue && t && !user && !pluginPath && !isJson && path.startsWith("/api/v1/")) {
    const isPublic = method === "GET" && /^\/api\/v1\/(scoreboard|notifications)/.test(path);
    if (!isPublic) return new Response(null, { status: 302, headers: { Location: "/login" } });
  }

  // Fichiers : jeton de fichier dans la requête (pas d'en-tête Authorization).
  const file = /^\/files\/([^/]+)\/(.+)$/.exec(path);
  if (file && method === "GET") {
    if (!url.searchParams.get("token")) return new Response("forbidden", { status: 403 });
    return new Response(`Contenu simulé de ${decodeURIComponent(file[2]!)}\n`, {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${file[2]}"` },
    });
  }

  if (!path.startsWith("/api/v1/")) return json(404, { success: false, errors: { _: ["not found"] } });

  const ctx: Ctx = {
    req,
    url,
    path: path.slice("/api/v1".length),
    user,
    body: async () => {
      try {
        return await req.json();
      } catch {
        return null;
      }
    },
  };

  // Routes publiques (scoreboard, notifications) : accessibles sans jeton.
  if (method === "GET" && ctx.path === "/scoreboard") return scoreboard();
  const top = /^\/scoreboard\/top\/(\d+)$/.exec(ctx.path);
  if (method === "GET" && top) return scoreboardTop(Number(top[1]));
  if (method === "GET" && ctx.path === "/notifications") return notifications(url);

  if (!user) return err(401, "Authentification requise");
  if (user.banned) return err(403, "Compte banni");

  const manager = user.role !== "player";
  if (ctx.path.startsWith("/manager/")) {
    if (!manager) return err(403, "Rôle manager requis");
    return managerRoutes(ctx, method);
  }
  if (ctx.path.startsWith("/instances")) return instanceRoutes(ctx, method);
  if (ctx.path.startsWith("/pad/teams")) return teamRoutes(ctx, method);
  if (ctx.path === "/pad/event" && method === "GET") return ok({ ...eventObj(), server_time: Math.floor(Date.now() / 1000) });
  if (ctx.path === "/pad/first-bloods" && method === "GET") return firstBloods(user, url);
  return nativeRoutes(ctx, method);
}

// ------------------------------------------------------------------ sso_bridge

async function ssoSession(req: Request, path: string): Promise<Response> {
  const s = state();
  const secret = process.env.PAD_SSO_SHARED_SECRET;
  if (!secret) return err(503, "secret HMAC non configuré");
  const raw = await req.text();
  const nonce = req.headers.get("x-pad-nonce");
  const valid = verifySso(
    secret,
    { timestamp: req.headers.get("x-pad-timestamp"), nonce, signature: req.headers.get("x-pad-signature") },
    { method: "POST", path, body: raw },
  );
  if (!valid || !nonce) return new Response("<html>401</html>", { status: 401, headers: { "Content-Type": "text/html" } });
  const now = Date.now();
  for (const [n, exp] of s.nonces) if (exp < now) s.nonces.delete(n);
  if (s.nonces.has(nonce)) return new Response("<html>401</html>", { status: 401, headers: { "Content-Type": "text/html" } });
  s.nonces.set(nonce, now + 121_000);

  let claims: { sub?: unknown; email?: unknown; preferred_username?: unknown; groups?: unknown };
  try {
    claims = JSON.parse(raw);
  } catch {
    return err(400, "JSON invalide");
  }
  const groups = Array.isArray(claims.groups) ? claims.groups.filter((x): x is string => typeof x === "string") : [];
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email.includes("@")) {
    return err(400, "sub/email invalides");
  }
  const role = roleFromGroups(groups);
  if (!role) return new Response("<html>403</html>", { status: 403, headers: { "Content-Type": "text/html" } });
  const email = claims.email.toLowerCase();
  let u = s.users.find((x) => x.sub === claims.sub);
  const created = !u;
  if (!u) {
    if (s.users.some((x) => x.email === email)) return err(409, "e-mail déjà lié à une autre identité");
    const base = typeof claims.preferred_username === "string" && claims.preferred_username ? claims.preferred_username : email.split("@")[0]!;
    u = { id: ++s.seq.user, sub: claims.sub, name: base, email, role, teamId: null, banned: false, hidden: role !== "player" };
    s.users.push(u);
  }
  u.role = role;
  if (u.banned) return err(403, "compte banni");
  const ttl = Number(process.env.PAD_MOCK_TOKEN_TTL_S) > 0 ? Number(process.env.PAD_MOCK_TOKEN_TTL_S) : 900;
  const token = `ctfd_mock_${crypto.randomUUID().replaceAll("-", "")}`;
  const exp = now + ttl * 1000;
  s.tokens.set(token, { userId: u.id, exp });
  const team = u.teamId != null ? s.teams.find((x) => x.id === u.teamId) : undefined;
  return ok({
    token,
    token_id: s.tokens.size,
    expires_at: iso(exp).replace(/\.\d{3}Z$/, "Z"),
    ttl,
    created,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      type: u.role === "admin" ? "admin" : "user",
      roles: u.role === "player" ? [] : [u.role],
      team_id: u.teamId,
      team_name: team?.name ?? null,
    },
  });
}

// ------------------------------------------------------------------ API native

function challengeListItem(c: FakeChallenge, user: FakeUser) {
  const s = state();
  const solvedByMe = s.solves.some((sv) => sv.challengeId === c.id && solveKey(sv) === userKey(user));
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    value: c.value,
    solves: s.solves.filter((sv) => sv.challengeId === c.id).length,
    solved_by_me: solvedByMe,
    category: c.category,
    tags: c.tags.map((value) => ({ value })),
    template: "",
    script: "",
  };
}

function nativeRoutes({ path, req, user, url, body }: Ctx, method: string): Response | Promise<Response> {
  const s = state();
  const me = user!;
  const acc = accountOf(me);

  if (method === "GET" && path === "/users/me") {
    return ok({
      id: me.id,
      name: me.name,
      email: me.email,
      team_id: me.teamId,
      score: ranking().find((r) => r.id === acc.id && r.isTeam === acc.isTeam)?.score ?? 0,
      place: ((p) => (p ? ordinal(p) : null))(placeOf(acc.id, acc.isTeam)),
      affiliation: null,
      country: null,
    });
  }
  const userById = /^\/users\/(\d+)$/.exec(path);
  if (userById && method === "GET") {
    const u = s.users.find((x) => x.id === Number(userById[1]));
    if (!u) return err(404, "Utilisateur inconnu");
    const score = s.solves.filter((sv) => sv.userId === u.id).reduce((n, sv) => n + valueOf(sv.challengeId), 0);
    return ok({ id: u.id, name: u.name, score });
  }
  if (method === "GET" && path === "/teams/me") {
    const t = me.teamId != null ? s.teams.find((x) => x.id === me.teamId) : undefined;
    if (!t) return err(404, "Pas d'équipe");
    return ok({
      id: t.id,
      name: t.name,
      score: ranking().find((r) => r.isTeam && r.id === t.id)?.score ?? 0,
      place: ((p) => (p ? ordinal(p) : null))(placeOf(t.id, true)),
      captain_id: t.captainId,
      members: s.users.filter((u) => u.teamId === t.id).map((u) => u.id),
    });
  }
  const mine = /^\/(users|teams)\/me\/(solves|fails)$/.exec(path);
  if (method === "GET" && mine) {
    const own = (x: { userId: number; teamId: number | null }) => (mine[1] === "teams" ? x.teamId === me.teamId && me.teamId != null : x.userId === me.id);
    if (mine[1] === "teams" && me.teamId == null) return err(404, "Pas d'équipe");
    if (mine[2] === "solves") {
      return ok(
        s.solves.filter(own).map((sv) => {
          const c = s.challenges.find((x) => x.id === sv.challengeId)!;
          const u = s.users.find((x) => x.id === sv.userId);
          return {
            challenge_id: sv.challengeId,
            challenge: { name: c.name, category: c.category, value: c.value },
            user: u ? { name: u.name } : null,
            date: sv.date,
          };
        }),
      );
    }
    return ok(s.fails.filter(own).map((f) => ({ challenge_id: f.challengeId, date: f.date })));
  }
  if (method === "GET" && path === "/challenges") {
    return ok(s.challenges.filter((c) => c.state === "visible").map((c) => challengeListItem(c, me)));
  }
  const chal = /^\/challenges\/(\d+)$/.exec(path);
  if (method === "GET" && chal) {
    const c = s.challenges.find((x) => x.id === Number(chal[1]));
    if (!c || (c.state !== "visible" && me.role === "player")) return err(404, "Challenge inconnu");
    const unlocked = new Set(s.unlocked.filter((u) => u.userId === me.id).map((u) => u.hintId));
    return ok({
      ...challengeListItem(c, me),
      description: c.description,
      connection_info: c.connectionInfo,
      max_attempts: c.maxAttempts,
      attempts: s.fails.filter((f) => f.challengeId === c.id && solveKey(f) === userKey(me)).length,
      files: c.files.map((f) => `/files/${"ab12cd34"}/${f}?token=mock-file-token`),
      hints: c.hints.map((h) => (unlocked.has(h.id) ? { id: h.id, cost: h.cost, content: h.content } : { id: h.id, cost: h.cost })),
      ...(c.type === "dynamic_instance" ? { instance: { timeout: c.ttl, until: null, max_renewals: 3, per_instance_flag: false } } : {}),
    });
  }
  if (method === "POST" && path === "/challenges/attempt") {
    return body().then((b) => {
      const input = (b ?? {}) as { challenge_id?: number; submission?: string };
      const c = s.challenges.find((x) => x.id === Number(input.challenge_id));
      if (!c || c.state !== "visible" || typeof input.submission !== "string") return err(404, "Challenge inconnu");
      const e = s.event;
      const nowSec = Date.now() / 1000;
      if (e.paused || (e.start && nowSec < e.start) || (e.end && nowSec > e.end)) {
        return json(403, { success: true, data: { status: "paused", message: "CTF en pause ou hors période" } });
      }
      const account = userKey(me);
      if (s.solves.some((sv) => sv.challengeId === c.id && solveKey(sv) === account)) {
        return ok({ status: "already_solved", message: "Vous avez déjà résolu ce challenge" });
      }
      const failCount = s.fails.filter((f) => f.challengeId === c.id && solveKey(f) === account).length;
      if (c.maxAttempts > 0 && failCount >= c.maxAttempts) {
        return json(403, { success: true, data: { status: "incorrect", message: "Plus de tentatives" } });
      }
      const recent = s.fails.filter((f) => f.userId === me.id && Date.now() - Date.parse(f.date) < 60_000).length;
      if (recent >= 40) return json(429, { success: true, data: { status: "ratelimited", message: "Trop de tentatives" } });
      if (c.flags.includes(input.submission.trim())) {
        s.solves.push({ id: ++s.seq.submission, challengeId: c.id, userId: me.id, teamId: me.teamId, date: iso(Date.now()) });
        return ok({ status: "correct", message: "Correct !" });
      }
      s.fails.push({ id: ++s.seq.submission, challengeId: c.id, userId: me.id, teamId: me.teamId, date: iso(Date.now()) });
      return ok({ status: "incorrect", message: "Incorrect" });
    });
  }
  if (method === "POST" && path === "/unlocks") {
    return body().then((b) => {
      const input = (b ?? {}) as { target?: number; type?: string };
      const hint = s.challenges.flatMap((c) => c.hints).find((h) => h.id === Number(input.target));
      if (!hint || input.type !== "hints") return err(400, "Indice inconnu");
      if (!s.unlocked.some((u) => u.userId === me.id && u.hintId === hint.id)) s.unlocked.push({ userId: me.id, hintId: hint.id });
      return ok({ id: hint.id }, 200);
    });
  }
  const hintById = /^\/hints\/(\d+)$/.exec(path);
  if (method === "GET" && hintById) {
    const hint = s.challenges.flatMap((c) => c.hints).find((h) => h.id === Number(hintById[1]));
    if (!hint) return err(404, "Indice inconnu");
    if (!s.unlocked.some((u) => u.userId === me.id && u.hintId === hint.id)) return err(403, "Indice verrouillé");
    return ok({ id: hint.id, cost: hint.cost, content: hint.content });
  }
  void req;
  void url;
  return err(404, `Route inconnue : ${method} ${path}`);
}

function scoreboard(): Response {
  return ok(
    ranking().map((r, i) => ({
      pos: i + 1,
      account_id: r.id,
      account_url: `/${r.isTeam ? "teams" : "users"}/${r.id}`,
      account_type: r.isTeam ? "team" : "user",
      name: r.name,
      score: r.score,
      ...(r.isTeam ? { members: Array.from({ length: r.members }, (_, k) => ({ id: k })) } : {}),
    })),
  );
}

function scoreboardTop(n: number): Response {
  const s = state();
  const out: Record<string, unknown> = {};
  ranking()
    .slice(0, n)
    .forEach((r, i) => {
      const solves = s.solves
        .filter((sv) => {
          const u = s.users.find((x) => x.id === sv.userId);
          const key = u ? accountOf(u) : null;
          return key && key.id === r.id && key.isTeam === r.isTeam;
        })
        .map((sv) => ({
          challenge_id: sv.challengeId,
          account_id: r.id,
          team_id: r.isTeam ? r.id : null,
          user_id: sv.userId,
          value: valueOf(sv.challengeId),
          date: sv.date,
        }));
      out[String(i + 1)] = { id: r.id, name: r.name, solves };
    });
  return ok(out);
}

function notifications(url: URL): Response {
  const since = Number(url.searchParams.get("since_id") ?? 0) || 0;
  return ok(state().notifications.filter((n) => n.id > since));
}

// ------------------------------------------------------------------ pad_teams

async function teamRoutes({ path, user, body }: Ctx, method: string): Promise<Response> {
  const s = state();
  const me = user!;
  const input = (await body()) as { name?: unknown; password?: unknown } | null;
  const teamObj = (t: FakeTeam) => ({
    id: t.id,
    name: t.name,
    captain_id: t.captainId,
    members: s.users.filter((u) => u.teamId === t.id).map((u) => ({ id: u.id, name: u.name })),
  });
  if (method !== "POST") return err(404, "Route inconnue");
  if (path === "/pad/teams") {
    if (typeof input?.name !== "string" || !input.name || input.name.length > 128 || typeof input.password !== "string" || !input.password) {
      return err(400, "Nom et mot de passe requis");
    }
    if (me.teamId != null) return err(409, "Vous êtes déjà dans une équipe");
    if (s.teams.some((t) => t.name.toLowerCase() === (input.name as string).toLowerCase())) return err(409, "Ce nom d'équipe est déjà pris");
    const t: FakeTeam = { id: ++s.seq.team, name: input.name, password: input.password, captainId: me.id, banned: false, hidden: false };
    s.teams.push(t);
    me.teamId = t.id;
    return ok(teamObj(t), 201);
  }
  if (path === "/pad/teams/join") {
    if (me.teamId != null) return err(409, "Vous êtes déjà dans une équipe");
    const t = s.teams.find((x) => x.name === input?.name && x.password === input?.password);
    if (!t || t.banned) return err(403, "Informations incorrectes");
    if (s.users.filter((u) => u.teamId === t.id).length >= 4) return err(403, "Équipe complète");
    me.teamId = t.id;
    return ok(teamObj(t));
  }
  if (path === "/pad/teams/leave") {
    const t = me.teamId != null ? s.teams.find((x) => x.id === me.teamId) : undefined;
    if (!t) return err(404, "Vous n'êtes dans aucune équipe");
    const members = s.users.filter((u) => u.teamId === t.id);
    if (s.solves.some((sv) => sv.userId === me.id)) return err(409, "Vous avez déjà marqué des points");
    if (t.captainId === me.id && members.length > 1) return err(409, "Transfer captaincy before leaving");
    me.teamId = null;
    if (members.length === 1) s.teams.splice(s.teams.indexOf(t), 1);
    return ok({});
  }
  return err(404, "Route inconnue");
}

// ------------------------------------------------------------------ chall_manager_bridge

const MAX_INSTANCES = 3;

function instanceObj(i: FakeInstance, c: FakeChallenge) {
  const now = Date.now();
  const nanos = (ms: number) => iso(ms).replace(/Z$/, "123456Z"); // chall-manager renvoie des nanosecondes
  return {
    challenge_id: i.challengeId,
    source_id: i.source,
    connection_info: `${c.category === "web" ? "http://" : "nc "}10.20.70.${100 + (i.port % 90)}${c.category === "web" ? ":8080" : " 1337"}`,
    since: nanos(i.since),
    last_renew: nanos(i.lastRenew),
    until: nanos(i.until),
    expires_in: Math.max(0, Math.round((i.until - now) / 1000)),
    renewals: i.renewals,
    max_renewals: 3,
    renewals_left: 3 - i.renewals,
    per_instance_flag: false,
  };
}

async function instanceRoutes({ path, user }: Ctx, method: string): Promise<Response> {
  const s = state();
  const me = user!;
  const source = me.teamId != null ? `team-${me.teamId}` : `user-${me.id}`;
  // Mode équipes : une équipe est obligatoire.
  if (me.teamId == null) return msg(403, "You must join a team first");
  const mine = s.instances.filter((i) => i.source === source);
  if (path === "/instances" && method === "GET") {
    return ok(mine.map((i) => instanceObj(i, s.challenges.find((c) => c.id === i.challengeId)!)));
  }
  const m = /^\/instances\/(\d+)$/.exec(path);
  if (!m) return msg(404, "Route inconnue");
  const c = s.challenges.find((x) => x.id === Number(m[1]));
  if (!c || c.type !== "dynamic_instance" || (c.state !== "visible" && me.role === "player")) return msg(404, "Challenge inconnu");
  const cur = mine.find((i) => i.challengeId === c.id);
  const nowSec = Date.now() / 1000;
  const closed = s.event.paused || (s.event.end != null && nowSec > s.event.end) || (s.event.start != null && nowSec < s.event.start);
  const privileged = me.role !== "player";
  if (method === "GET") return cur ? ok(instanceObj(cur, c)) : msg(404, "Aucune instance");
  if (method === "POST") {
    if (closed && !privileged) return msg(403, "CTF en pause ou hors période");
    if (cur) return msg(409, "Une instance existe déjà");
    if (mine.length >= MAX_INSTANCES && !privileged) return msg(429, "Quota d'instances atteint");
    const now = Date.now();
    const inst: FakeInstance = { challengeId: c.id, source, since: now, lastRenew: now, until: now + c.ttl * 1000, renewals: 0, port: ++s.seq.port };
    s.instances.push(inst);
    return ok(instanceObj(inst, c), 201);
  }
  if (method === "PATCH") {
    if (closed && !privileged) return msg(403, "CTF en pause ou hors période");
    if (!cur) return msg(404, "Aucune instance");
    if (cur.renewals >= 3 && !privileged) return msg(429, "Plus de renouvellement possible");
    cur.renewals += 1;
    cur.lastRenew = Date.now();
    cur.until = Date.now() + c.ttl * 1000;
    return ok(instanceObj(cur, c));
  }
  if (method === "DELETE") {
    if (cur) s.instances.splice(s.instances.indexOf(cur), 1);
    return ok({});
  }
  return msg(404, "Route inconnue");
}

// ------------------------------------------------------------------ manager_api

function eventObj() {
  const e = state().event;
  const now = Date.now() / 1000;
  const st = e.end && now >= e.end ? "ended" : e.start && now < e.start ? "not_started" : e.paused ? "paused" : e.freeze && now >= e.freeze ? "frozen" : "running";
  return { start: e.start, end: e.end, freeze: e.freeze, paused: e.paused, state: st };
}

function statsOf(c: FakeChallenge) {
  const s = state();
  const visible = (userId: number) => {
    const u = s.users.find((x) => x.id === userId);
    return !!u && !u.hidden && !u.banned;
  };
  const solves = s.solves.filter((sv) => sv.challengeId === c.id && visible(sv.userId));
  const incorrect = s.fails.filter((f) => f.challengeId === c.id && visible(f.userId)).length;
  const attempts = solves.length + incorrect;
  return {
    solves: solves.length,
    attempts,
    incorrect,
    rate: attempts ? Math.round((solves.length / attempts) * 10000) / 10000 : 0,
    list: solves.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
  };
}

async function managerRoutes({ path, req, url, body, user }: Ctx, method: string): Promise<Response> {
  const s = state();
  const row = (c: FakeChallenge) => {
    const st = statsOf(c);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      type: c.type,
      state: c.state,
      value: c.value,
      function: "static",
      instance: c.type === "dynamic_instance",
      tags: c.tags,
      solves: st.solves,
      attempts: st.attempts,
      success_rate: st.rate,
    };
  };
  if (path === "/manager/challenges" && method === "GET") {
    const rows = s.challenges.map(row);
    const solves = rows.reduce((n, r) => n + r.solves, 0);
    const attempts = rows.reduce((n, r) => n + r.attempts, 0);
    return json(200, {
      success: true,
      data: rows,
      meta: { count: rows.length, solves, attempts, success_rate: attempts ? Math.round((solves / attempts) * 10000) / 10000 : 0 },
    });
  }
  const stats = /^\/manager\/challenges\/(\d+)\/stats$/.exec(path);
  if (stats && method === "GET") {
    const c = s.challenges.find((x) => x.id === Number(stats[1]));
    if (!c) return err(404, "Challenge inconnu");
    const bucket = url.searchParams.get("bucket") ?? "hour";
    if (bucket !== "hour" && bucket !== "day") return err(400, "bucket invalide");
    const st = statsOf(c);
    const groups = new Map<string, number>();
    for (const sv of st.list) {
      const d = new Date(sv.date);
      if (bucket === "hour") d.setUTCMinutes(0, 0, 0);
      else d.setUTCHours(0, 0, 0, 0);
      const k = d.toISOString().replace(/\.\d{3}Z$/, "Z");
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    let cumulative = 0;
    const first = st.list[0];
    const fu = first ? s.users.find((u) => u.id === first.userId) : undefined;
    return ok({
      ...row(c),
      incorrect_attempts: st.incorrect,
      first_blood: first && fu ? { account_id: accountOf(fu).id, account_name: accountOf(fu).name, user_id: fu.id, user_name: fu.name, date: first.date } : null,
      bucket,
      solves_over_time: [...groups.entries()].map(([t, n]) => ({ t, solves: n, cumulative: (cumulative += n) })),
    });
  }
  if (/^\/manager\/(users|teams|submissions|awards)(\/|$)/.test(path)) return moderationRoutes({ path, url, body }, method, user!);
  if (path === "/manager/event") {
    if (method === "GET") return ok(eventObj());
    if (method === "PATCH") {
      const b = (await body()) as Record<string, unknown> | null;
      if (!b || Object.keys(b).length === 0) return err(400, "Corps vide");
      const next = { ...s.event };
      for (const [k, v] of Object.entries(b)) {
        if (k === "paused") {
          if (typeof v !== "boolean") return err(400, "paused doit être booléen");
          next.paused = v;
        } else if (k === "start" || k === "end" || k === "freeze") {
          if (v === null) next[k] = null;
          else if (typeof v === "number" && v >= 0) next[k] = Math.floor(v);
          else if (typeof v === "string" && Number.isFinite(Date.parse(v))) next[k] = Math.floor(Date.parse(v) / 1000);
          else return err(400, `${k} illisible`);
        } else return err(400, `champ inconnu : ${k}`);
      }
      if (next.start != null && next.end != null && next.start >= next.end) return err(422, "start doit précéder end");
      if (next.freeze != null && ((next.start != null && next.freeze < next.start) || (next.end != null && next.freeze > next.end))) {
        return err(422, "freeze doit être entre start et end");
      }
      s.event = next;
      return ok(eventObj());
    }
  }
  if (path === "/manager/challenges/import" && method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err(400, "multipart/form-data attendu");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return err(400, "champ file absent");
    const preview = await inspectChallengeZip(await file.arrayBuffer());
    if (!preview.ok || !preview.challenge) {
      return json(422, { success: false, errors: { "challenge.yml": preview.issues.map((i) => `${i.path}: ${i.message}`) } });
    }
    const y = preview.challenge;
    const existing = s.challenges.find((c) => c.name === y.name);
    const flags = y.flags.map((f) => (typeof f === "string" ? f : f.content));
    const value = y.type === "dynamic" ? (y.extra?.initial ?? 0) : (y.value ?? 0);
    const type = y.instance ? "dynamic_instance" : "standard";
    if (existing && existing.type !== type) return err(409, "changement de type interdit");
    const hints = y.hints.map((h) => (typeof h === "string" ? { cost: 0, content: h } : { cost: h.cost, content: h.content }));
    const next: Omit<FakeChallenge, "id"> = {
      name: y.name,
      category: y.category,
      type,
      state: y.state,
      value,
      description: y.description,
      tags: y.tags,
      flags,
      hints: hints.map((h) => ({ ...h, id: ++s.seq.hint })),
      files: y.files.map((f) => f.split("/").pop()!),
      connectionInfo: y.connection_info ?? null,
      maxAttempts: y.attempts ?? 0,
      ttl: y.instance?.ttl ?? 0,
    };
    let c: FakeChallenge;
    if (existing) {
      Object.assign(existing, next);
      c = existing;
    } else {
      c = { id: ++s.seq.challenge, ...next };
      s.challenges.push(c);
    }
    return ok(
      {
        id: c.id,
        name: c.name,
        action: existing ? "updated" : "created",
        type: c.type,
        state: c.state,
        value: c.value,
        instance: c.type === "dynamic_instance",
        flags: flags.length,
        hints: hints.length,
        tags: c.tags.length,
        files: c.files,
        files_uploaded: c.files,
      },
      existing ? 200 : 201,
    );
  }
  return err(404, "Route inconnue");
}

// ------------------------------------------------------------------ pad_public

/** `GET /api/v1/pad/first-bloods` : premier solve par challenge (joueurs : visibles seulement, avant le gel). */
function firstBloods(user: FakeUser | null, url: URL): Response {
  const s = state();
  const privileged = !!user && user.role !== "player";
  const only = url.searchParams.get("challenge_id");
  if (only !== null && !/^\d+$/.test(only)) return err(400, "challenge_id must be an integer");
  const freezeMs = s.event.freeze != null && !privileged ? s.event.freeze * 1000 : null;
  const seen = new Map<number, object>();
  for (const sv of [...s.solves].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id - b.id)) {
    if (seen.has(sv.challengeId) || (only !== null && sv.challengeId !== Number(only))) continue;
    const c = s.challenges.find((x) => x.id === sv.challengeId);
    const u = s.users.find((x) => x.id === sv.userId);
    if (!c || !u || u.banned || u.hidden || (!privileged && c.state !== "visible")) continue;
    const acc = accountOf(u);
    const t = acc.isTeam ? s.teams.find((x) => x.id === acc.id) : undefined;
    if (t && (t.banned || t.hidden)) continue;
    if (freezeMs != null && Date.parse(sv.date) > freezeMs) continue;
    seen.set(sv.challengeId, {
      challenge_id: sv.challengeId,
      account_id: acc.id,
      account_name: acc.name,
      user_id: u.id,
      user_name: u.name,
      date: sv.date,
    });
  }
  return ok([...seen.values()]);
}

// ------------------------------------------------------------------ manager_api : modération

function pageOf<T>(rows: T[], url: URL): Response {
  const page = Number(url.searchParams.get("page") ?? 1);
  const perPage = Number(url.searchParams.get("per_page") ?? 50);
  if (!Number.isInteger(page) || !Number.isInteger(perPage) || page < 1 || perPage < 1 || perPage > 200) {
    return err(400, "page must be >= 1 and per_page within 1..200");
  }
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  return json(200, { success: true, data: slice, meta: { page, per_page: perPage, total: rows.length, count: slice.length } });
}

function boolFilter(url: URL, name: string): boolean | null | "invalid" {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (["1", "true"].includes(raw.toLowerCase())) return true;
  if (["0", "false"].includes(raw.toLowerCase())) return false;
  return "invalid";
}

async function moderationRoutes({ path, url, body }: Pick<Ctx, "path" | "url" | "body">, method: string, me: FakeUser): Promise<Response> {
  const s = state();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const banned = boolFilter(url, "banned");
  const hidden = boolFilter(url, "hidden");
  if (banned === "invalid" || hidden === "invalid") return err(400, "banned and hidden must be true or false");

  const userRow = (u: FakeUser) => {
    const t = u.teamId != null ? s.teams.find((x) => x.id === u.teamId) : undefined;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      type: u.role === "admin" ? "admin" : "user",
      roles: u.role === "player" ? [] : [u.role],
      team_id: u.teamId,
      team_name: t?.name ?? null,
      banned: u.banned,
      hidden: u.hidden,
    };
  };
  const teamRow = (t: FakeTeam) => ({
    id: t.id,
    name: t.name,
    captain_id: t.captainId,
    member_count: s.users.filter((u) => u.teamId === t.id).length,
    banned: t.banned,
    hidden: t.hidden,
  });
  const flags = (r: { banned: boolean; hidden: boolean }) => (banned === null || r.banned === banned) && (hidden === null || r.hidden === hidden);

  if (method === "GET" && path === "/manager/users") {
    return pageOf(
      s.users
        .filter((u) => (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && flags(u))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(userRow),
      url,
    );
  }
  if (method === "GET" && path === "/manager/teams") {
    return pageOf(
      s.teams
        .filter((t) => (!q || t.name.toLowerCase().includes(q)) && flags(t))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(teamRow),
      url,
    );
  }

  const patchable = /^\/manager\/(users|teams)\/(\d+)$/.exec(path);
  if (patchable && method === "PATCH") {
    const input = (await body()) as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Object.keys(input).length === 0) return err(400, "JSON object expected");
    for (const [k, v] of Object.entries(input)) {
      if (k !== "banned" && k !== "hidden") return err(400, `Unknown field(s): ${k}`);
      if (typeof v !== "boolean") return err(400, `${k} must be a boolean`);
    }
    const patch = input as { banned?: boolean; hidden?: boolean };
    if (patchable[1] === "users") {
      const u = s.users.find((x) => x.id === Number(patchable[2]));
      if (!u) return err(404, "No user with this id");
      if (u.id === me.id) return err(403, "You cannot moderate yourself");
      if (u.role !== "player" && me.role !== "admin") return err(403, "Only an admin can moderate a manager or an admin");
      if (patch.banned !== undefined) u.banned = patch.banned;
      if (patch.hidden !== undefined) u.hidden = patch.hidden;
      return ok(userRow(u));
    }
    const t = s.teams.find((x) => x.id === Number(patchable[2]));
    if (!t) return err(404, "No team with this id");
    const members = s.users.filter((u) => u.teamId === t.id);
    if (me.teamId === t.id) return err(403, "You cannot moderate your own team");
    if (members.some((u) => u.role !== "player") && me.role !== "admin") return err(403, "Only an admin can moderate a team with a manager or an admin");
    if (patch.banned !== undefined) t.banned = patch.banned;
    if (patch.hidden !== undefined) t.hidden = patch.hidden;
    return ok(teamRow(t));
  }

  if (path === "/manager/submissions" && method === "GET") {
    const type = url.searchParams.get("type");
    const rows = [...s.solves.map((x) => ({ ...x, type: "correct" })), ...s.fails.map((x) => ({ ...x, type: "incorrect" }))]
      .filter((x) => !type || x.type === type)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id - a.id)
      .map((x) => ({
        id: x.id,
        type: x.type,
        challenge_id: x.challengeId,
        challenge_name: s.challenges.find((c) => c.id === x.challengeId)?.name ?? null,
        user_id: x.userId,
        user_name: s.users.find((u) => u.id === x.userId)?.name ?? null,
        team_id: x.teamId,
        team_name: s.teams.find((t) => t.id === x.teamId)?.name ?? null,
        provided: "",
        date: x.date,
      }));
    return pageOf(rows, url);
  }
  const sub = /^\/manager\/submissions\/(\d+)$/.exec(path);
  if (sub && method === "DELETE") {
    const id = Number(sub[1]);
    const si = s.solves.findIndex((x) => x.id === id);
    if (si !== -1) s.solves.splice(si, 1);
    else {
      const fi = s.fails.findIndex((x) => x.id === id);
      if (fi === -1) return err(404, "No submission with this id");
      s.fails.splice(fi, 1);
    }
    return ok({ id });
  }
  if (path === "/manager/awards" && method === "GET") {
    return pageOf(
      [...s.awards].reverse().map((a) => ({
        id: a.id,
        name: a.name,
        description: null,
        category: null,
        value: a.value,
        user_id: a.userId,
        user_name: s.users.find((u) => u.id === a.userId)?.name ?? null,
        team_id: a.teamId,
        team_name: s.teams.find((t) => t.id === a.teamId)?.name ?? null,
        date: a.date,
      })),
      url,
    );
  }
  const aw = /^\/manager\/awards\/(\d+)$/.exec(path);
  if (aw && method === "DELETE") {
    const i = s.awards.findIndex((a) => a.id === Number(aw[1]));
    if (i === -1) return err(404, "No award with this id");
    s.awards.splice(i, 1);
    return ok({ id: Number(aw[1]) });
  }
  return err(404, "Route inconnue");
}
