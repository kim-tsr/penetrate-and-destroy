#!/usr/bin/env bash
# Pile e2e locale : démarre docker compose, initialise CTFd, crée des challenges et exécute des smoke tests.
#
# USAGE
#   task e2e                      # up + seed + smoke (équivaut à `tests/e2e/run.sh all`)
#   tests/e2e/run.sh up           # build + démarrage (attend les healthchecks)
#   tests/e2e/run.sh seed         # assistant /setup de CTFd + 2 challenges (flag statique, instance) ; écrit .state/e2e.env
#   tests/e2e/run.sh smoke        # vérifications HTTP bout en bout (joueur : flag, instance, scoreboard)
#   tests/e2e/run.sh down         # arrête et supprime volumes et conteneurs
#   tests/e2e/run.sh logs [svc]   # journaux
#
# VARIABLES : E2E_CTFD_PORT (8000), E2E_FRONT_PORT (3000), E2E_CM_PORT (8080), E2E_CM_LATENCY_MS (0),
#   E2E_ADMIN_PASSWORD (valeur jetable par défaut), E2E_KEEP=1 (ne pas faire `down` à la fin de `all`),
#   E2E_WAIT_TIMEOUT (secondes d'attente de santé HTTP, 180), E2E_UP_TIMEOUT (secondes de `compose up --wait`, 900).
# En cas d'échec, `all` affiche l'état des conteneurs et les 200 dernières lignes de journaux de CHAQUE service
# (groupes repliables `::group::` sur GitHub Actions) avant d'arrêter la pile.
# Le service `front` est ajouté automatiquement si apps/frontend/Dockerfile existe.
# Prérequis : docker (compose v2), curl, openssl, python3.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STATE="$ROOT/.state"
CTFD="http://127.0.0.1:${E2E_CTFD_PORT:-8000}"
CM="http://127.0.0.1:${E2E_CM_PORT:-8080}"
FRONT="http://127.0.0.1:${E2E_FRONT_PORT:-3000}"
SSO_SECRET="e2e-only-sso-shared-secret" # = x-e2e-secrets dans docker-compose.yml (valeur jetable)
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-e2e-only-admin-pass-1}"
FLAG="PAD{e2e-static-flag}"

cd "$HERE"
if [ -f "$ROOT/apps/frontend/Dockerfile" ]; then
  export COMPOSE_PROFILES="${COMPOSE_PROFILES:-front}"
fi
# Sortie de build lisible dans les journaux CI (pas de barre de progression dynamique).
export COMPOSE_PROGRESS="${COMPOSE_PROGRESS:-plain}"
compose() { docker compose "$@"; }
log() { printf '[e2e] %s\n' "$*" >&2; }
json() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {"d": d}))' "$1"; }
# Toutes les requêtes ont un délai : un service bloqué fait échouer l'étape au lieu de la figer.
CURL=(curl --connect-timeout 5 --max-time 60)

# Token API CTFd via /api/v1/sso/session (HMAC-SHA256, voir apps/ctfd/API.md section 2).
# Chaque essai signe avec un NOUVEAU nonce (un nonce rejoué est refusé par CTFd). Imprime le token ; sinon code 1
# après 5 essais, la réponse du serveur étant journalisée sur stderr.
mint_token() { # $1 = nom, $2 = groupe OIDC
  local name="$1" group="$2" body ts nonce hash msg sig out code attempt
  body=$(printf '{"sub":"e2e-%s","email":"%s@e2e.invalid","preferred_username":"%s","groups":["%s"]}' "$name" "$name" "$name" "$group")
  for attempt in 1 2 3 4 5; do
    ts=$(date +%s)
    nonce=$(openssl rand -hex 16)
    hash=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
    msg=$(printf '%s\n%s\n%s\n%s\n%s' "$ts" "$nonce" POST /api/v1/sso/session "$hash")
    sig=$(printf '%s' "$msg" | openssl dgst -sha256 -hmac "$SSO_SECRET" -r | cut -d' ' -f1)
    out=$("${CURL[@]}" -sS -w '\n%{http_code}' -X POST "$CTFD/api/v1/sso/session" -H 'Content-Type: application/json' \
      -H "X-PAD-Timestamp: $ts" -H "X-PAD-Nonce: $nonce" -H "X-PAD-Signature: $sig" --data-binary "$body" 2>&1) || true
    code="${out##*$'\n'}"
    if [ "$code" = 200 ] && printf '%s' "${out%$'\n'*}" | json 'd["data"]["token"]' 2>/dev/null; then
      return 0
    fi
    log "sso/session ($name) essai $attempt/5 : HTTP $code ${out%$'\n'*}"
    sleep 2
  done
  return 1
}
api() { # $1 = token, $2 = méthode, $3 = chemin, $4 = corps JSON optionnel ; imprime "<code> <corps>" (code 000 si le réseau échoue)
  local out data=()
  if [ -n "${4:-}" ]; then data=(--data-binary "$4"); fi
  out=$("${CURL[@]}" -sS -w '\n%{http_code}' -X "$2" "$CTFD$3" -H "Authorization: Token $1" -H 'Content-Type: application/json' "${data[@]}" 2>&1) || true
  printf '%s %s' "${out##*$'\n'}" "${out%$'\n'*}"
}

# wait_http <libellé> <url> : attend un 2xx jusqu'à E2E_WAIT_TIMEOUT secondes et journalise la dernière réponse.
wait_http() {
  local label="$1" url="$2" deadline code
  deadline=$(($(date +%s) + ${E2E_WAIT_TIMEOUT:-180}))
  while :; do
    code=$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$url" 2>&1) || true
    case "$code" in
      2??)
        log "$label prêt ($url)"
        return 0
        ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "ÉCHEC : $label injoignable après ${E2E_WAIT_TIMEOUT:-180}s ($url, dernière réponse : $code)"
      return 1
    fi
    sleep 3
  done
}

cmd_up() {
  log "build + démarrage de la pile (profils : ${COMPOSE_PROFILES:-aucun})"
  compose config --services >&2
  compose up -d --build --wait --wait-timeout "${E2E_UP_TIMEOUT:-900}"
  compose ps -a >&2
  wait_http "CTFd" "$CTFD/healthcheck"
  wait_http "mock chall-manager" "$CM/healthz"
  if [ -f "$ROOT/apps/frontend/Dockerfile" ]; then wait_http "front" "$FRONT/api/health"; fi
}

# Assistant /setup de CTFd. Un SEUL GET fournit à la fois le cookie de session et le nonce (le nonce est lié à la
# session) ; le POST réutilise ce cookie. CTFd répond 200 avec le formulaire (et ses erreurs) si la validation échoue
# et 302 si le POST réussit : on vérifie donc ensuite que /setup n'est plus servi (redirection).
setup_ctfd() {
  local code nonce page="$STATE/e2e.setup.html" jar="$STATE/e2e.cookies"
  rm -f "$jar" "$page"
  code=$("${CURL[@]}" -sS -c "$jar" -o "$page" -w '%{http_code}' "$CTFD/setup" 2>&1) || true
  if [ "$code" != 200 ]; then
    log "CTFd déjà initialisé (GET /setup -> HTTP $code)"
    return 0
  fi
  log "assistant de configuration CTFd"
  nonce=$(python3 -I -c '
import re, sys
html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for tag in re.findall(r"<input[^>]*>", html):
    if re.search(r"""name=["\x27]nonce["\x27]""", tag):
        m = re.search(r"""value=["\x27]([^"\x27]*)["\x27]""", tag)
        if m:
            print(m.group(1))
            break
' "$page")
  if [ -z "$nonce" ]; then
    log "ÉCHEC : nonce introuvable dans /setup ; début de la page :"
    head -c 1500 "$page" >&2 || true
    return 1
  fi
  code=$("${CURL[@]}" -sS -b "$jar" -c "$jar" -o "$page" -w '%{http_code}' "$CTFD/setup" \
    -F "ctf_name=PAD e2e" -F "ctf_description=e2e" -F "user_mode=users" \
    -F "challenge_visibility=private" -F "account_visibility=public" -F "score_visibility=public" \
    -F "registration_visibility=public" -F "verify_emails=false" -F "team_size=" \
    -F "name=e2e-setup-admin" -F "email=setup-admin@e2e.invalid" -F "password=$ADMIN_PASSWORD" \
    -F "ctf_theme=core" -F "theme_color=" -F "start=" -F "end=" -F "nonce=$nonce" -F "_submit=Finish" 2>&1) || true
  log "POST /setup -> HTTP $code"
  code=$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$CTFD/setup" 2>&1) || true
  if [ "$code" = 200 ]; then
    log "ÉCHEC : /setup est encore servi après le POST (validation refusée). Messages d'erreur du formulaire :"
    python3 -I -c '
import re, sys
html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
msgs = re.findall(r"(?is)<(?:div|span|small|p)[^>]*(?:alert|error|invalid|danger)[^>]*>(.*?)</(?:div|span|small|p)>", html)
for m in msgs[:10]:
    print(" - " + re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m)).strip())
if not msgs:
    print(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))[:1200])
' "$STATE/e2e.setup.html" >&2 || true
    return 1
  fi
  log "CTFd initialisé (GET /setup -> HTTP $code)"
}

cmd_seed() {
  mkdir -p "$STATE"
  setup_ctfd
  local admin out std_id inst_id
  admin=$(mint_token admin ctf-admins) || { log "ÉCHEC : token admin non émis"; return 1; }
  out=$(api "$admin" GET /api/v1/challenges)
  if [ "${out%% *}" != 200 ]; then
    log "ÉCHEC : GET /api/v1/challenges -> ${out:0:600}"
    return 1
  fi
  if printf '%s' "$out" | grep -q '"e2e-static"'; then
    log "challenges déjà créés"
  else
    api "$admin" POST /api/v1/challenges '{"name":"e2e-static","category":"misc","description":"flag statique","value":100,"state":"visible","type":"standard"}' >"$STATE/e2e.std.json"
    api "$admin" POST /api/v1/challenges '{"name":"e2e-instance","category":"pwn","description":"instance","value":200,"state":"visible","type":"dynamic_instance","timeout":600,"max_renewals":3,"instance_config":{"image":"registry.invalid/e2e:1"}}' >"$STATE/e2e.inst.json"
    for f in std inst; do
      if [ "$(cut -c1-3 "$STATE/e2e.$f.json")" != 200 ]; then
        log "ÉCHEC : création du challenge $f -> $(head -c 600 "$STATE/e2e.$f.json")"
        return 1
      fi
    done
    std_id=$(cut -d' ' -f2- "$STATE/e2e.std.json" | json 'd["data"]["id"]')
    inst_id=$(cut -d' ' -f2- "$STATE/e2e.inst.json" | json 'd["data"]["id"]')
    out=$(api "$admin" POST /api/v1/flags "{\"challenge_id\":$std_id,\"type\":\"static\",\"content\":\"$FLAG\"}")
    [ "${out%% *}" = 200 ] || { log "ÉCHEC : flag statique -> ${out:0:600}"; return 1; }
    out=$(api "$admin" POST /api/v1/flags "{\"challenge_id\":$inst_id,\"type\":\"static\",\"content\":\"PAD{e2e-instance-flag}\"}")
    [ "${out%% *}" = 200 ] || { log "ÉCHEC : flag d'instance -> ${out:0:600}"; return 1; }
  fi
  out=$(api "$admin" GET /api/v1/challenges | cut -d' ' -f2-)
  std_id=$(printf '%s' "$out" | json '[c["id"] for c in d["data"] if c["name"]=="e2e-static"][0]')
  inst_id=$(printf '%s' "$out" | json '[c["id"] for c in d["data"] if c["name"]=="e2e-instance"][0]')
  {
    echo "PAD_CTFD_URL=$CTFD"
    echo "PAD_BASE_URL=${PAD_BASE_URL:-$CTFD}"
    echo "PAD_FLAG_CHALLENGE_ID=$std_id"
    echo "PAD_INSTANCE_CHALLENGE_IDS=$inst_id"
    echo "PAD_SSO_SECRET=$SSO_SECRET"
  } >"$STATE/e2e.env"
  log "seed OK (challenges $std_id, $inst_id) ; variables k6 : $STATE/e2e.env"
}

ok=0
ko=0
DETAIL=""
check() { # $1 = libellé, suite = commande ; en cas d'échec, affiche $DETAIL (dernière réponse API) pour le diagnostic
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "OK  $label"
    ok=$((ok + 1))
  else
    echo "KO  $label"
    if [ -n "$DETAIL" ]; then echo "      réponse : ${DETAIL:0:500}"; fi
    ko=$((ko + 1))
  fi
  DETAIL=""
}
expect_code() { # $1 = code attendu, $2 = résultat de api()
  [ "${2%% *}" = "$1" ]
}
# Le scoreboard peut être mis en cache quelques secondes par CTFd : on réessaie brièvement.
scoreboard_has() { # $1 = token, $2 = nom
  local out
  for _ in 1 2 3 4 5 6; do
    out=$(api "$1" GET /api/v1/scoreboard)
    DETAIL="$out"
    if grep -q "$2" <<<"$out"; then return 0; fi
    sleep 2
  done
  return 1
}

cmd_smoke() {
  # shellcheck disable=SC1091
  . "$STATE/e2e.env"
  check "CTFd /healthcheck" "${CURL[@]}" -fsS "$CTFD/healthcheck"
  check "mock chall-manager /healthz" "${CURL[@]}" -fsS "$CM/healthz"
  if [ -f "$ROOT/apps/frontend/Dockerfile" ]; then
    check "front /api/health" "${CURL[@]}" -fsS "$FRONT/api/health"
  fi
  local player out
  player=$(mint_token "player$$" ctf-players) || player=""
  check "token joueur émis par sso_bridge" test -n "$player"
  if [ -z "$player" ]; then
    echo
    echo "Résultat : $ok OK, $((ko)) KO (arrêt : sans token joueur, les vérifications suivantes sont impossibles)"
    return 1
  fi
  out=$(api "$player" GET /api/v1/challenges)
  DETAIL="$out"
  check "liste des challenges (>= 2)" test "$(printf '%s' "${out#* }" | json 'len(d["data"])' 2>/dev/null || echo 0)" -ge 2
  out=$(api "$player" POST /api/v1/challenges/attempt "{\"challenge_id\":$PAD_FLAG_CHALLENGE_ID,\"submission\":\"PAD{wrong}\"}")
  DETAIL="$out"
  check "flag incorrect refusé" grep -q '"incorrect"' <<<"$out"
  out=$(api "$player" POST /api/v1/challenges/attempt "{\"challenge_id\":$PAD_FLAG_CHALLENGE_ID,\"submission\":\"$FLAG\"}")
  DETAIL="$out"
  check "flag correct accepté" grep -q '"correct"' <<<"$out"
  out=$(api "$player" POST "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  DETAIL="$out"
  check "lancement d'instance (201)" expect_code 201 "$out"
  out=$(api "$player" PATCH "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  DETAIL="$out"
  check "prolongation d'instance (200)" expect_code 200 "$out"
  out=$(api "$player" DELETE "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  DETAIL="$out"
  check "arrêt d'instance (200)" expect_code 200 "$out"
  check "scoreboard contient le joueur" scoreboard_has "$player" "player$$"
  check "métriques CTFd (Bearer)" "${CURL[@]}" -fsS -H 'Authorization: Bearer e2e-only-metrics-token' "$CTFD/metrics"
  echo
  echo "Résultat : $ok OK, $ko KO"
  [ "$ko" -eq 0 ]
}

# Diagnostic complet en cas d'échec : état des conteneurs puis journaux de chaque service.
dump_diagnostics() {
  local svc gha=0
  [ "${GITHUB_ACTIONS:-}" = true ] && gha=1
  echo "[e2e] === diagnostic : état des conteneurs ===" >&2
  compose ps -a >&2 || true
  for svc in $(compose config --services 2>/dev/null); do
    if [ "$gha" = 1 ]; then echo "::group::journaux $svc" >&2; else echo "[e2e] === journaux $svc ===" >&2; fi
    compose logs --no-color --tail 200 "$svc" >&2 || true
    if [ "$gha" = 1 ]; then echo "::endgroup::" >&2; fi
  done
}

# Chaque étape tourne dans son propre processus : `set -e` y reste actif (il serait ignoré dans une fonction
# appelée depuis une liste `||`) et le code de sortie de chaque étape est fidèle.
rc=0
finish() {
  if [ "$rc" -ne 0 ]; then dump_diagnostics; fi
  if [ "${E2E_KEEP:-0}" != 1 ]; then compose down -v --remove-orphans >&2 || true; fi
}
run_all() {
  trap finish EXIT
  "$HERE/run.sh" up || rc=$?
  if [ "$rc" -eq 0 ]; then "$HERE/run.sh" seed || rc=$?; fi
  if [ "$rc" -eq 0 ]; then "$HERE/run.sh" smoke || rc=$?; fi
  exit "$rc"
}

case "${1:-all}" in
  up) cmd_up ;;
  seed) cmd_seed ;;
  smoke) cmd_smoke ;;
  down) compose down -v --remove-orphans ;;
  logs) shift; compose logs --tail 200 "$@" ;;
  all) run_all ;;
  *) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
