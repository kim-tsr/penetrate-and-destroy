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
#   E2E_ADMIN_PASSWORD (valeur jetable par défaut), E2E_KEEP=1 (ne pas faire `down` en cas d'échec de `all`).
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
compose() { docker compose "$@"; }
log() { printf '[e2e] %s\n' "$*" >&2; }
json() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {"d": d}))' "$1"; }

# Token API CTFd via /api/v1/sso/session (HMAC-SHA256, voir apps/ctfd/API.md section 2).
mint_token() { # $1 = nom, $2 = groupe OIDC
  local name="$1" group="$2" body ts nonce hash msg sig
  body=$(printf '{"sub":"e2e-%s","email":"%s@e2e.invalid","preferred_username":"%s","groups":["%s"]}' "$name" "$name" "$name" "$group")
  ts=$(date +%s)
  nonce=$(openssl rand -hex 16)
  hash=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
  msg=$(printf '%s\n%s\n%s\n%s\n%s' "$ts" "$nonce" POST /api/v1/sso/session "$hash")
  sig=$(printf '%s' "$msg" | openssl dgst -sha256 -hmac "$SSO_SECRET" -r | cut -d' ' -f1)
  curl -fsS -X POST "$CTFD/api/v1/sso/session" -H 'Content-Type: application/json' \
    -H "X-PAD-Timestamp: $ts" -H "X-PAD-Nonce: $nonce" -H "X-PAD-Signature: $sig" --data-binary "$body" \
    | json 'd["data"]["token"]'
}
api() { # $1 = token, $2 = méthode, $3 = chemin, $4 = corps JSON optionnel ; imprime "<code> <corps>"
  local out data=()
  if [ -n "${4:-}" ]; then data=(--data-binary "$4"); fi
  out=$(curl -sS -w '\n%{http_code}' -X "$2" "$CTFD$3" -H "Authorization: Token $1" -H 'Content-Type: application/json' "${data[@]}")
  printf '%s %s' "${out##*$'\n'}" "${out%$'\n'*}"
}

cmd_up() {
  log "build + démarrage de la pile"
  compose up -d --build --wait --wait-timeout 600
}

cmd_seed() {
  mkdir -p "$STATE"
  if ! curl -fsS "$CTFD/setup" -o /dev/null -c "$STATE/e2e.cookies" -w '%{http_code}' | grep -q 200; then
    log "CTFd déjà initialisé (assistant /setup indisponible)"
  else
    log "assistant de configuration CTFd"
    local nonce
    nonce=$(curl -fsS -b "$STATE/e2e.cookies" "$CTFD/setup" | sed -n 's/.*name="nonce"[^>]*value="\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$nonce" ] || { log "nonce /setup introuvable"; exit 1; }
    curl -fsS -b "$STATE/e2e.cookies" -c "$STATE/e2e.cookies" -o /dev/null "$CTFD/setup" \
      -F "ctf_name=PAD e2e" -F "ctf_description=e2e" -F "user_mode=users" \
      -F "challenge_visibility=private" -F "account_visibility=public" -F "score_visibility=public" \
      -F "registration_visibility=public" -F "verify_emails=false" -F "team_size=" \
      -F "name=e2e-setup-admin" -F "email=setup-admin@e2e.invalid" -F "password=$ADMIN_PASSWORD" \
      -F "ctf_theme=core" -F "theme_color=" -F "start=" -F "end=" -F "nonce=$nonce" -F "_submit=Finish"
  fi
  local admin out std_id inst_id
  admin=$(mint_token admin ctf-admins)
  out=$(api "$admin" GET /api/v1/challenges)
  if printf '%s' "$out" | grep -q '"e2e-static"'; then
    log "challenges déjà créés"
  else
    api "$admin" POST /api/v1/challenges '{"name":"e2e-static","category":"misc","description":"flag statique","value":100,"state":"visible","type":"standard"}' >"$STATE/e2e.std.json"
    api "$admin" POST /api/v1/challenges '{"name":"e2e-instance","category":"pwn","description":"instance","value":200,"state":"visible","type":"dynamic_instance","timeout":600,"max_renewals":3,"instance_config":{"image":"registry.invalid/e2e:1"}}' >"$STATE/e2e.inst.json"
    std_id=$(cut -d' ' -f2- "$STATE/e2e.std.json" | json 'd["data"]["id"]')
    inst_id=$(cut -d' ' -f2- "$STATE/e2e.inst.json" | json 'd["data"]["id"]')
    api "$admin" POST /api/v1/flags "{\"challenge_id\":$std_id,\"type\":\"static\",\"content\":\"$FLAG\"}" >/dev/null
    api "$admin" POST /api/v1/flags "{\"challenge_id\":$inst_id,\"type\":\"static\",\"content\":\"PAD{e2e-instance-flag}\"}" >/dev/null
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
check() { # $1 = libellé, suite = commande
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "OK  $label"
    ok=$((ok + 1))
  else
    echo "KO  $label"
    ko=$((ko + 1))
  fi
}
expect_code() { # $1 = code attendu, $2 = résultat de api()
  [ "${2%% *}" = "$1" ]
}

cmd_smoke() {
  # shellcheck disable=SC1091
  . "$STATE/e2e.env"
  check "CTFd /healthcheck" curl -fsS "$CTFD/healthcheck"
  check "mock chall-manager /healthz" curl -fsS "$CM/healthz"
  if [ -f "$ROOT/apps/frontend/Dockerfile" ]; then
    check "front /api/health" curl -fsS "$FRONT/api/health"
  fi
  local player out
  player=$(mint_token "player$$" ctf-players)
  check "token joueur émis par sso_bridge" test -n "$player"
  out=$(api "$player" GET /api/v1/challenges)
  check "liste des challenges (>= 2)" test "$(printf '%s' "${out#* }" | json 'len(d["data"])')" -ge 2
  out=$(api "$player" POST /api/v1/challenges/attempt "{\"challenge_id\":$PAD_FLAG_CHALLENGE_ID,\"submission\":\"PAD{wrong}\"}")
  check "flag incorrect refusé" grep -q '"incorrect"' <<<"$out"
  out=$(api "$player" POST /api/v1/challenges/attempt "{\"challenge_id\":$PAD_FLAG_CHALLENGE_ID,\"submission\":\"$FLAG\"}")
  check "flag correct accepté" grep -q '"correct"' <<<"$out"
  out=$(api "$player" POST "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  check "lancement d'instance (201)" expect_code 201 "$out"
  out=$(api "$player" PATCH "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  check "prolongation d'instance (200)" expect_code 200 "$out"
  out=$(api "$player" DELETE "/api/v1/instances/$PAD_INSTANCE_CHALLENGE_IDS")
  check "arrêt d'instance (200)" expect_code 200 "$out"
  out=$(api "$player" GET /api/v1/scoreboard)
  check "scoreboard contient le joueur" grep -q "player$$" <<<"$out"
  check "métriques CTFd (Bearer)" curl -fsS -H 'Authorization: Bearer e2e-only-metrics-token' "$CTFD/metrics"
  echo
  echo "Résultat : $ok OK, $ko KO"
  [ "$ko" -eq 0 ]
}

case "${1:-all}" in
  up) cmd_up ;;
  seed) cmd_seed ;;
  smoke) cmd_smoke ;;
  down) compose down -v --remove-orphans ;;
  logs) shift; compose logs --tail 200 "$@" ;;
  all)
    cmd_up
    cmd_seed
    if cmd_smoke; then
      rc=0
    else
      rc=1
      compose logs --tail 80 ctfd chall-manager >&2 || true
    fi
    if [ "${E2E_KEEP:-0}" != 1 ]; then compose down -v --remove-orphans; fi
    exit "$rc"
    ;;
  *) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
