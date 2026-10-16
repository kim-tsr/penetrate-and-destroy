#!/usr/bin/env bash
# Fonctions communes à scripts/backup.sh et scripts/restore.sh (sourcé, ne pas exécuter).
# shellcheck disable=SC2034  # variables consommées par les scripts appelants

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${PAD_STATE_DIR:-$ROOT/.state}"
export KUBECONFIG="${KUBECONFIG:-$STATE_DIR/kubeconfig}"

# Valeurs par défaut alignées sur gitops/ (contracts: namespaces.*, apps.garage.*).
CTFD_NS="${PAD_CTFD_NAMESPACE:-ctfd}"
MARIADB_POD="${PAD_MARIADB_POD:-ctfd-mariadb-0}"
MARIADB_CONTAINER="${PAD_MARIADB_CONTAINER:-mariadb}"
MARIADB_DATABASE="${PAD_MARIADB_DATABASE:-ctfd}"
STORAGE_NS="${PAD_STORAGE_NAMESPACE:-storage}"
GARAGE_SVC="${PAD_GARAGE_SERVICE:-garage}"
# Secret déchiffré par ksops depuis gitops/platform/garage/secret-s3.sops.yaml (même clé que AWS_* de CTFd).
GARAGE_CREDS_SECRET="${PAD_GARAGE_CREDS_SECRET:-garage-s3-credentials}"
GARAGE_REGION="${PAD_GARAGE_REGION:-garage}"
BUCKETS="${PAD_BACKUP_BUCKETS:-ctfd-uploads backups}"
BACKUP_DIR="${PAD_BACKUP_DIR:-$STATE_DIR/backups}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "ERREUR : $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "outil manquant : $1 (lancer depuis \`nix develop\`)"; }

# rclone : binaire du PATH, à défaut `nix shell` (comme infra/ansible/Taskfile.yml pour ansible-lint).
rclone_bin() {
  if command -v rclone >/dev/null 2>&1; then
    rclone "$@"
  elif command -v nix >/dev/null 2>&1; then
    nix shell nixpkgs#rclone -c rclone "$@"
  else
    die "rclone introuvable (ni dans le PATH, ni via nix)"
  fi
}

# Charge la configuration du S3 externe (optionnel). Sources, par priorité :
#   1. variables d'environnement PAD_BACKUP_S3_* déjà définies ;
#   2. secrets/backup-s3.sops.yaml (chiffré SOPS/age, SOPS_AGE_KEY_FILE requis), clés : endpoint, region, bucket,
#      prefix, access_key_id, secret_access_key.
# Positionne EXT_ENABLED=1 si une destination complète est disponible. Aucun secret n'est affiché ni passé en argv :
# rclone lit sa configuration depuis RCLONE_CONFIG_EXT_* (variables d'environnement).
load_external_s3() {
  EXT_ENABLED=0
  local f="$ROOT/secrets/backup-s3.sops.yaml"
  if [ -z "${PAD_BACKUP_S3_BUCKET:-}" ] && [ -f "$f" ] && command -v sops >/dev/null 2>&1 && [ -n "${SOPS_AGE_KEY_FILE:-}" ]; then
    local k v
    for k in endpoint region bucket prefix access_key_id secret_access_key; do
      v="$(sops -d --extract "[\"$k\"]" "$f" 2>/dev/null || true)"
      if [ -n "$v" ]; then
        export "PAD_BACKUP_S3_$(printf '%s' "$k" | tr '[:lower:]' '[:upper:]')=$v"
      fi
    done
  fi
  if [ -n "${PAD_BACKUP_S3_BUCKET:-}" ] && [ -n "${PAD_BACKUP_S3_ACCESS_KEY_ID:-}" ] && [ -n "${PAD_BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
    EXT_ENABLED=1
    EXT_BUCKET="$PAD_BACKUP_S3_BUCKET"
    EXT_PREFIX="${PAD_BACKUP_S3_PREFIX:-pad}"
    export RCLONE_CONFIG_EXT_TYPE=s3
    export RCLONE_CONFIG_EXT_PROVIDER="${PAD_BACKUP_S3_PROVIDER:-Other}"
    export RCLONE_CONFIG_EXT_ACCESS_KEY_ID="$PAD_BACKUP_S3_ACCESS_KEY_ID"
    export RCLONE_CONFIG_EXT_SECRET_ACCESS_KEY="$PAD_BACKUP_S3_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_EXT_REGION="${PAD_BACKUP_S3_REGION:-}"
    if [ -n "${PAD_BACKUP_S3_ENDPOINT:-}" ]; then
      export RCLONE_CONFIG_EXT_ENDPOINT="$PAD_BACKUP_S3_ENDPOINT"
    fi
  fi
}

# Ouvre un port-forward vers Garage (S3) et configure le remote rclone `garage`. Fermé à la sortie du script.
GARAGE_PF_PID=""
close_garage() {
  if [ -n "$GARAGE_PF_PID" ]; then
    kill "$GARAGE_PF_PID" 2>/dev/null || true
    GARAGE_PF_PID=""
  fi
}
open_garage() {
  need kubectl
  local ak sk port i
  ak="$(kubectl -n "$STORAGE_NS" get secret "$GARAGE_CREDS_SECRET" -o jsonpath='{.data.access_key_id}' | base64 -d)"
  sk="$(kubectl -n "$STORAGE_NS" get secret "$GARAGE_CREDS_SECRET" -o jsonpath='{.data.secret_access_key}' | base64 -d)"
  if [ -z "$ak" ] || [ -z "$sk" ]; then
    die "secret $STORAGE_NS/$GARAGE_CREDS_SECRET vide ou absent (sync ArgoCD de Garage et secret-s3.sops.yaml présent ?)"
  fi
  port="${PAD_GARAGE_LOCAL_PORT:-$((20000 + RANDOM % 20000))}"
  kubectl -n "$STORAGE_NS" port-forward "svc/$GARAGE_SVC" "$port:3900" >/dev/null 2>&1 &
  GARAGE_PF_PID=$!
  trap close_garage EXIT
  for i in $(seq 1 30); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then break; fi
    kill -0 "$GARAGE_PF_PID" 2>/dev/null || die "port-forward vers Garage terminé prématurément"
    [ "$i" -lt 30 ] || die "port-forward vers Garage indisponible"
    sleep 1
  done
  export RCLONE_CONFIG_GARAGE_TYPE=s3
  export RCLONE_CONFIG_GARAGE_PROVIDER=Other
  export RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID="$ak"
  export RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY="$sk"
  export RCLONE_CONFIG_GARAGE_REGION="$GARAGE_REGION"
  export RCLONE_CONFIG_GARAGE_ENDPOINT="http://127.0.0.1:$port"
  export RCLONE_CONFIG_GARAGE_FORCE_PATH_STYLE=true
}
