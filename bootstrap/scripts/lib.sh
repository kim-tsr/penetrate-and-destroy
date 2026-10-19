#!/usr/bin/env bash
# Fonctions communes aux scripts de bootstrap. À sourcer : `source "$(dirname "$0")/lib.sh"`.
# shellcheck shell=bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS="${ROOT_DIR}/infra/contracts.yaml"
STATE_DIR="${STATE_DIR:-${ROOT_DIR}/.state}"
GITOPS_DIR="${ROOT_DIR}/gitops"
PLATFORM_DIR="${GITOPS_DIR}/platform"

# Fichiers d'accès produits par le bootstrap (jamais le kubeconfig par défaut de l'opérateur).
KIND_KUBECONFIG="${STATE_DIR}/kind.kubeconfig"
PROD_KUBECONFIG="${STATE_DIR}/kubeconfig"
# shellcheck disable=SC2034  # utilisé par les scripts qui sourcent lib.sh
PROD_TALOSCONFIG="${STATE_DIR}/talosconfig"
# shellcheck disable=SC2034  # utilisé par les scripts qui sourcent lib.sh
KIND_CLUSTER_NAME="pad-bootstrap"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] WARN\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] ERREUR\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

require_cmd() {
  local missing=()
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
  ((${#missing[@]} == 0)) || die "outils manquants : ${missing[*]} (lancer 'nix develop')"
}

# Lecture du contrat : contract '.kubernetes.cluster_name'
contract() { yq -e "$1" "$CONTRACTS"; }

# Valeurs de site de l'opérateur (secrets/site.sops.yaml, chiffré) : site_get proxmox_url | ssh_host | ssh_user | wan.ip ...
# Déchiffrées à la volée par sops puis lues avec yq ; jamais écrites sur disque.
site_get() {
  local file="${ROOT_DIR}/secrets/site.sops.yaml" val
  [[ -f "$file" ]] || die "valeurs de site manquantes : secrets/site.sops.yaml (voir secrets/site.example.yaml)"
  val=$(sops --decrypt --output-type yaml "$file" | yq -r ".$1 // \"\"")
  [[ -n "$val" && "$val" != null ]] || die "secrets/site.sops.yaml : clé '$1' à renseigner"
  printf '%s' "$val"
}

# retry <tentatives> <pause_s> <commande...>
retry() {
  local tries=$1 pause=$2 n=1
  shift 2
  until "$@"; do
    ((n >= tries)) && return 1
    warn "échec ($n/$tries) : $* ; nouvel essai dans ${pause}s"
    sleep "$pause"
    n=$((n + 1))
  done
}

# wait_for <timeout_s> <description> <commande...> : attend que la commande réussisse.
wait_for() {
  local timeout=$1 what=$2 start
  shift 2
  start=$(date +%s)
  log "attente : ${what} (max ${timeout}s)"
  until "$@" >/dev/null 2>&1; do
    if (($(date +%s) - start > timeout)); then
      die "délai dépassé : ${what}"
    fi
    sleep 10
  done
  log "ok : ${what}"
}

# kubectl/helm/clusterctl contextualisés : KUBECONFIG explicite, jamais celui de l'environnement.
kkind() { kubectl --kubeconfig "$KIND_KUBECONFIG" "$@"; }
kprod() { kubectl --kubeconfig "$PROD_KUBECONFIG" "$@"; }
hprod() { helm --kubeconfig "$PROD_KUBECONFIG" "$@"; }

# Valeur d'une source Helm d'une Application ArgoCD (source unique des versions de charts).
#   app_chart_field <fichier application.yaml> <nom du chart> <champ: repoURL|targetRevision>
app_chart_field() {
  yq -e "(.spec.sources // [.spec.source])[] | select(.chart == \"$2\") | .$3" "$1"
}

# Chemin du fichier de values d'une Application (dans le repo) : <dossier composant>/values.yaml
values_of() { printf '%s/%s/values.yaml' "$PLATFORM_DIR" "$1"; }

# Installe/met à jour un chart avec exactement la version et les values de l'Application ArgoCD,
# afin qu'ArgoCD adopte ensuite la release sans recréation.
#   helm_from_app <composant> <chart> <release> <namespace> [args helm supplémentaires...]
helm_from_app() {
  local comp=$1 chart=$2 release=$3 ns=$4
  shift 4
  local app="${PLATFORM_DIR}/${comp}/application.yaml" repo version ref
  repo=$(app_chart_field "$app" "$chart" repoURL)
  version=$(app_chart_field "$app" "$chart" targetRevision)
  if [[ "$repo" == oci://* || "$repo" != http* ]]; then
    ref="oci://${repo#oci://}/${chart}"
  else
    ref="$chart"
    set -- --repo "$repo" "$@"
  fi
  log "helm ${release} (${chart}@${version}) -> ${ns}"
  # Upgrade précédent interrompu (ex. « etcdserver: request timed out ») : la release reste en pending-* et tout nouvel
  # upgrade échoue (« another operation is in progress »). Retour à la dernière révision déployée, puis upgrade normal.
  local st last
  st=$(hprod -n "$ns" status "$release" -o json 2>/dev/null | jq -r '.info.status // empty')
  if [[ "$st" == pending-* ]]; then
    last=$(hprod -n "$ns" history "$release" -o json 2>/dev/null | jq -r '[.[] | select(.status=="deployed" or .status=="superseded")] | last | .revision // empty')
    if [[ -n "$last" ]]; then
      warn "release ${release} en ${st} : retour à la révision ${last} avant l'upgrade"
      hprod -n "$ns" rollback "$release" "$last" --wait=false
    fi
  fi
  hprod upgrade --install "$release" "$ref" --version "$version" \
    --namespace "$ns" --create-namespace \
    --values "$(values_of "$comp")" --wait --timeout 10m "$@"
}

# Déchiffre une clé d'un fichier SOPS (secrets/<domaine>.sops.yaml).
sops_get() {
  local file=$1 key=$2
  [[ -f "$file" ]] || die "secret manquant : $file (voir ${file%.sops.yaml}.example.yaml)"
  sops --decrypt --extract "$key" "$file"
}

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
