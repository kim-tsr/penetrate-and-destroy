// Test de charge k6 de PenetrateAndDestroy : navigation, soumissions de flags, SSE du scoreboard, instances.
// Usage et variables : voir README.md. Lancement : `task load` ou `k6 run tests/load/pad.js`.
//
// Cibles : le front (PAD_BASE_URL) pour les pages et le SSE, CTFd (PAD_CTFD_URL) pour l'API avec un token par joueur.
// Aucune valeur réelle par défaut : tout se passe sur 127.0.0.1 tant que les variables ne sont pas fournies.
import http from "k6/http";
import crypto from "k6/crypto";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ---------- Paramètres ----------
const env = (name, def) => (__ENV[name] !== undefined && __ENV[name] !== "" ? __ENV[name] : def);
const BASE = env("PAD_BASE_URL", "http://127.0.0.1:3000").replace(/\/$/, "");
const CTFD = env("PAD_CTFD_URL", "http://127.0.0.1:8000").replace(/\/$/, "");
const PROFILE = env("PAD_PROFILE", "smoke"); // smoke | load | stress
const SCENARIOS = env("PAD_SCENARIOS", "browse,flags,sse,instances").split(",").map((s) => s.trim());
const BROWSE_PATHS = env("PAD_BROWSE_PATHS", "/,/api/health").split(",");
const SSE_PATH = env("PAD_SSE_PATH", "/api/scoreboard/stream");
const SSE_HOLD_S = parseInt(env("PAD_SSE_HOLD_SECONDS", "20"), 10);
const FLAG_CHALLENGE_ID = env("PAD_FLAG_CHALLENGE_ID", "");
const CORRECT_FLAG = env("PAD_FLAG", ""); // facultatif : un joueur sur PAD_FLAG_CORRECT_EVERY soumet le bon flag
const CORRECT_EVERY = parseInt(env("PAD_FLAG_CORRECT_EVERY", "0"), 10);
const INSTANCE_IDS = env("PAD_INSTANCE_CHALLENGE_IDS", "").split(",").filter((s) => s !== "");
const INSTANCE_HOLD_S = parseFloat(env("PAD_INSTANCE_HOLD_SECONDS", "2"));
const TOKEN_USERS = parseInt(env("PAD_TOKEN_USERS", "20"), 10);

// Profils : multiplicateur de VUs et durée du palier stable (surchargeables : PAD_VUS, PAD_DURATION).
const PROFILES = {
  smoke: { vus: 2, hold: "20s", ramp: "5s" },
  load: { vus: 50, hold: "5m", ramp: "1m" },
  stress: { vus: 200, hold: "10m", ramp: "3m" },
};
const P = PROFILES[PROFILE];
if (!P) throw new Error(`PAD_PROFILE inconnu : ${PROFILE} (smoke, load, stress)`);
const VUS = parseInt(env("PAD_VUS", String(P.vus)), 10);
const HOLD = env("PAD_DURATION", P.hold);
const stages = (peak) => [
  { duration: P.ramp, target: Math.max(1, Math.round(peak)) },
  { duration: HOLD, target: Math.max(1, Math.round(peak)) },
  { duration: P.ramp, target: 0 },
];

// ---------- Métriques ----------
const instanceLaunch = new Trend("pad_instance_launch_duration", true);
const instanceThrottled = new Rate("pad_instance_throttled");
const flagThrottled = new Rate("pad_flag_throttled");
const flagSubmissions = new Counter("pad_flag_submissions");
const sseOk = new Rate("pad_sse_ok");
const sseTtfb = new Trend("pad_sse_ttfb", true);

// ---------- Scénarios ----------
const allScenarios = {
  browse: { executor: "ramping-vus", exec: "browse", startVUs: 0, stages: stages(VUS), gracefulRampDown: "10s" },
  flags: { executor: "ramping-vus", exec: "flags", startVUs: 0, stages: stages(VUS / 2), gracefulRampDown: "10s" },
  // Un VU = une connexion SSE tenue PAD_SSE_HOLD_SECONDS ; la charge SSE est volontairement la plus élevée.
  sse: { executor: "ramping-vus", exec: "sse", startVUs: 0, stages: stages(VUS * 2), gracefulRampDown: `${SSE_HOLD_S + 5}s` },
  instances: { executor: "ramping-vus", exec: "instances", startVUs: 0, stages: stages(VUS / 5), gracefulRampDown: "30s" },
};
const active = {};
for (const name of SCENARIOS) {
  if (!allScenarios[name]) throw new Error(`scénario inconnu : ${name}`);
  if (name === "flags" && !FLAG_CHALLENGE_ID) continue; // nécessite PAD_FLAG_CHALLENGE_ID
  if (name === "instances" && INSTANCE_IDS.length === 0) continue; // nécessite PAD_INSTANCE_CHALLENGE_IDS
  active[name] = allScenarios[name];
}

// Seuils : les clés avec {scenario:...} n'existent que si le scénario est actif.
const thresholds = {
  checks: ["rate>0.95"],
  http_req_failed: ["rate<0.02"],
};
if (active.browse) {
  thresholds["http_req_duration{scenario:browse}"] = ["p(95)<800", "p(99)<2000"];
  thresholds["http_req_failed{scenario:browse}"] = ["rate<0.01"];
}
if (active.flags) {
  thresholds["http_req_duration{scenario:flags}"] = ["p(95)<1000", "p(99)<2500"];
  thresholds["http_req_failed{scenario:flags}"] = ["rate<0.01"];
}
if (active.sse) {
  thresholds["pad_sse_ok"] = ["rate>0.98"];
  thresholds["pad_sse_ttfb"] = ["p(95)<1500"];
}
if (active.instances) {
  thresholds["pad_instance_launch_duration"] = ["p(95)<15000"];
  thresholds["http_req_failed{scenario:instances}"] = ["rate<0.05"];
}

export const options = {
  scenarios: active,
  thresholds,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// ---------- Jeux de tokens ----------
// 1. PAD_TOKENS="tok1,tok2,..." : tokens API CTFd existants (campagne sur le serveur, TTL à respecter) ;
// 2. sinon PAD_SSO_SECRET : crée PAD_TOKEN_USERS joueurs via /api/v1/sso/session (secret partagé HMAC).
function mintToken(secret, index, runId) {
  const body = JSON.stringify({
    sub: `load-${runId}-${index}`,
    email: `load-${runId}-${index}@load.invalid`,
    preferred_username: `load${runId}u${index}`,
    groups: ["ctf-players"],
  });
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.md5(`${runId}-${index}-${Math.random()}`, "hex") + crypto.md5(`${index}-${ts}`, "hex");
  const msg = [ts, nonce, "POST", "/api/v1/sso/session", crypto.sha256(body, "hex")].join("\n");
  const sig = crypto.hmac("sha256", secret, msg, "hex");
  const res = http.post(`${CTFD}/api/v1/sso/session`, body, {
    headers: {
      "Content-Type": "application/json",
      "X-PAD-Timestamp": String(ts),
      "X-PAD-Nonce": nonce,
      "X-PAD-Signature": sig,
    },
    tags: { name: "setup_sso_session" },
  });
  if (res.status !== 200) throw new Error(`sso/session a répondu ${res.status} (secret, CIDR autorisés, groupes ?)`);
  return res.json("data.token");
}

export function setup() {
  let tokens = env("PAD_TOKENS", "").split(",").filter((t) => t !== "");
  if (tokens.length === 0 && env("PAD_SSO_SECRET", "") !== "") {
    const runId = Date.now().toString(36);
    for (let i = 0; i < TOKEN_USERS; i++) tokens.push(mintToken(__ENV.PAD_SSO_SECRET, i, runId));
  }
  if (tokens.length === 0 && (active.flags || active.instances)) {
    throw new Error("PAD_TOKENS ou PAD_SSO_SECRET requis pour les scénarios flags et instances");
  }
  return { tokens };
}

const auth = (data) => ({ Authorization: `Token ${data.tokens[(__VU - 1) % data.tokens.length]}` });
const json = (data, extra = {}) => ({ headers: { ...auth(data), "Content-Type": "application/json" }, ...extra });

// ---------- Scénario : navigation ----------
export function browse(data) {
  for (const path of BROWSE_PATHS) {
    const res = http.get(`${BASE}${path}`, {
      redirects: 0,
      tags: { name: `GET ${path}` },
      responseCallback: http.expectedStatuses({ min: 200, max: 399 }),
    });
    check(res, { "page 2xx/3xx": (r) => r.status >= 200 && r.status < 400 });
    sleep(Math.random() * 2 + 0.5);
  }
  if (data.tokens.length > 0) {
    for (const path of ["/api/v1/challenges", "/api/v1/scoreboard"]) {
      const res = http.get(`${CTFD}${path}`, { headers: auth(data), tags: { name: `GET ${path}` } });
      check(res, { "API CTFd 200": (r) => r.status === 200 });
      sleep(Math.random() + 0.3);
    }
  }
}

// ---------- Scénario : soumissions de flags ----------
// CTFd limite les mauvaises tentatives par compte (429) : ces 429 sont attendus et suivis par pad_flag_throttled.
export function flags(data) {
  const correct = CORRECT_FLAG !== "" && CORRECT_EVERY > 0 && Math.random() * CORRECT_EVERY < 1;
  const submission = correct ? CORRECT_FLAG : `PAD{load-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e6)}}`;
  const res = http.post(
    `${CTFD}/api/v1/challenges/attempt`,
    JSON.stringify({ challenge_id: parseInt(FLAG_CHALLENGE_ID, 10), submission }),
    json(data, { tags: { name: "POST /api/v1/challenges/attempt" }, responseCallback: http.expectedStatuses(200, 429) }),
  );
  flagSubmissions.add(1);
  flagThrottled.add(res.status === 429);
  check(res, { "tentative traitée (200/429)": (r) => r.status === 200 || r.status === 429 });
  sleep(Math.random() * 3 + 2);
}

// ---------- Scénario : SSE du scoreboard ----------
// k6 natif n'a pas d'EventSource : on ouvre le flux, on le laisse tenir PAD_SSE_HOLD_SECONDS (le timeout de la requête
// met fin à la connexion, ce qui est le comportement attendu) et on mesure le délai avant les premiers octets.
// Pour compter les évènements reçus, utiliser l'extension xk6-sse (hors périmètre).
export function sse() {
  const res = http.get(`${BASE}${SSE_PATH}`, {
    headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    timeout: `${SSE_HOLD_S}s`,
    tags: { name: "GET sse" },
    responseCallback: http.expectedStatuses(0, 200),
  });
  const held = res.status === 200 || res.error_code === 1050; // 1050 = timeout de requête = flux resté ouvert
  sseOk.add(held);
  if (res.timings.waiting > 0) sseTtfb.add(res.timings.waiting);
  check(res, { "flux SSE ouvert": () => held });
  sleep(1);
}

// ---------- Scénario : lancement d'instances ----------
// Cycle complet par itération : démarrer, prolonger, arrêter. 429 (quota/cooldown) et 409 sont tolérés et mesurés.
export function instances(data) {
  const cid = INSTANCE_IDS[Math.floor(Math.random() * INSTANCE_IDS.length)];
  const url = `${CTFD}/api/v1/instances/${cid}`;
  const start = http.post(url, null, json(data, { tags: { name: "POST /api/v1/instances/:id" }, responseCallback: http.expectedStatuses(201, 409, 429) }));
  instanceThrottled.add(start.status === 429);
  if (start.status === 201) {
    instanceLaunch.add(start.timings.duration);
    sleep(INSTANCE_HOLD_S);
    const renew = http.patch(url, null, json(data, { tags: { name: "PATCH /api/v1/instances/:id" }, responseCallback: http.expectedStatuses(200, 429) }));
    check(renew, { "prolongation 200/429": (r) => r.status === 200 || r.status === 429 });
  }
  check(start, { "instance créée ou refusée proprement (201/409/429)": (r) => [201, 409, 429].includes(r.status) });
  // DELETE est idempotent : toujours nettoyer, même après un 409.
  const del = http.del(url, null, json(data, { tags: { name: "DELETE /api/v1/instances/:id" }, responseCallback: http.expectedStatuses(200, 404) }));
  check(del, { "arrêt 200": (r) => r.status === 200 || r.status === 404 });
  sleep(Math.random() * 3 + 1);
}

export function handleSummary(data) {
  const out = { stdout: textSummary(data) };
  if (env("PAD_SUMMARY_JSON", "") !== "") out[env("PAD_SUMMARY_JSON", "")] = JSON.stringify(data, null, 2);
  return out;
}

function textSummary(data) {
  const m = data.metrics;
  const p = (name, stat) => (m[name] && m[name].values[stat] !== undefined ? m[name].values[stat].toFixed(1) : "n/a");
  const lines = [
    `\nProfil ${PROFILE} (VUs de référence ${VUS}, palier ${HOLD}) -> scénarios : ${Object.keys(active).join(", ") || "aucun"}`,
    `requêtes http : ${m.http_reqs ? m.http_reqs.values.count : 0} | échecs : ${m.http_req_failed ? (m.http_req_failed.values.rate * 100).toFixed(2) : "0"} %`,
    `http_req_duration p95 : ${p("http_req_duration", "p(95)")} ms`,
    `pad_instance_launch_duration p95 : ${p("pad_instance_launch_duration", "p(95)")} ms`,
    `pad_sse_ttfb p95 : ${p("pad_sse_ttfb", "p(95)")} ms`,
    "",
  ];
  return lines.join("\n");
}
