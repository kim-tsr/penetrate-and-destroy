#!/usr/bin/env bash
# Fonctions Cluster API partagées par cluster.sh et destroy.sh. À sourcer.
# shellcheck shell=bash
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PROXMOX_SOPS="${ROOT_DIR}/secrets/proxmox.sops.yaml"
CLUSTERCTL_CONFIG="${ROOT_DIR}/bootstrap/clusterctl.yaml"
export CLUSTERCTL_DISABLE_VERSIONCHECK=true

CLUSTER_NAME=$(contract '.kubernetes.cluster_name')
CLUSTER_NS=$(contract '.kubernetes.capi_namespace')

# Identifiants CAPMOX : variables d'environnement uniquement (jamais écrites sur disque).
load_proxmox_env() {
  local token url
  token=$(sops_get "$PROXMOX_SOPS" '["proxmox"]["api_token"]')
  [[ "$token" == *'!'*=* ]] || die "proxmox.api_token doit être au format user@realm!tokenid=secret"
  url=$(site_get proxmox_url)
  PROXMOX_URL="${url%/}"
  PROXMOX_TOKEN="${token%%=*}"
  PROXMOX_SECRET="${token#*=}"
  export PROXMOX_URL PROXMOX_TOKEN PROXMOX_SECRET
}

# Création idempotente du cluster kind éphémère (version et image du contrat).
ensure_kind() {
  local want have image
  want=$(contract '.kubernetes.kind_version')
  have=$(kind version | awk '{print $2}')
  [[ "$have" == "$want" ]] || die "kind ${have} installé, le contrat exige ${want}"
  image=$(contract '.kubernetes.kind_node_image')
  if kind get clusters 2>/dev/null | grep -qx "$KIND_CLUSTER_NAME"; then
    log "kind '${KIND_CLUSTER_NAME}' existe déjà : réutilisation"
    kind export kubeconfig --name "$KIND_CLUSTER_NAME" --kubeconfig "$KIND_KUBECONFIG"
  else
    log "création du cluster kind '${KIND_CLUSTER_NAME}' (${image})"
    kind create cluster --name "$KIND_CLUSTER_NAME" --image "$image" --kubeconfig "$KIND_KUBECONFIG" --wait 5m
  fi
  chmod 600 "$KIND_KUBECONFIG"
}

# clusterctl init (providers et versions du contrat) sur le cluster désigné par $1 (kubeconfig).
capi_init() {
  local kc=$1
  if kubectl --kubeconfig "$kc" get crd clusters.cluster.x-k8s.io >/dev/null 2>&1; then
    log "Cluster API déjà initialisé sur ${kc##*/}"
    return 0
  fi
  load_proxmox_env
  log "clusterctl init sur ${kc##*/}"
  clusterctl init --kubeconfig "$kc" --config "$CLUSTERCTL_CONFIG" \
    --core "cluster-api:$(contract '.kubernetes.capi.core')" \
    --bootstrap "talos:$(contract '.kubernetes.capi.bootstrap_talos')" \
    --control-plane "talos:$(contract '.kubernetes.capi.control_plane_talos')" \
    --infrastructure "proxmox:$(contract '.kubernetes.capi.infrastructure_proxmox')" \
    --ipam "in-cluster:$(contract '.kubernetes.capi.ipam_in_cluster')"
}

# Attend que les controllers CAPI du cluster $1 (kubeconfig) soient disponibles.
capi_wait_controllers() {
  local kc=$1 d
  for d in capi-system/capi-controller-manager cabpt-system/cabpt-controller-manager \
    cacppt-system/cacppt-controller-manager capmox-system/capmox-controller-manager \
    capi-ipam-in-cluster-system/capi-ipam-in-cluster-controller-manager; do
    wait_for 600 "deployment ${d}" \
      kubectl --kubeconfig "$kc" -n "${d%%/*}" wait --for=condition=Available "deployment/${d##*/}" --timeout=10s
  done
}

# Le Cluster existe-t-il dans le cluster de gestion $1 (kubeconfig) ?
has_cluster() {
  kubectl --kubeconfig "$1" -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" >/dev/null 2>&1
}
