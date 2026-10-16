#!/usr/bin/env bash
# Détruit le cluster pad-prod et ses VMs.
# Le cluster étant auto-géré, il ne peut pas se supprimer lui-même : on fait un pivot inverse
# (prod -> kind) puis on supprime l'objet Cluster depuis kind, en attendant la disparition des Machines.
# Fallback (confirmation obligatoire) : suppression des VMs par tag via l'API Proxmox.
# shellcheck source=bootstrap/scripts/capi-common.sh
source "$(dirname "$0")/capi-common.sh"

require_cmd kind docker kubectl clusterctl yq sops

machines_gone() { [[ -z "$(kkind -n "$CLUSTER_NS" get machines -o name 2>/dev/null)" ]]; }

# ArgoCD (Application cluster-prod en auto-sync/selfHeal) recréerait les objets Cluster API que `clusterctl move`
# retire de pad-prod. On arrête donc son application-controller (scale 0) avant le pivot inverse : le cluster
# est de toute façon détruit ensuite, et `root`/`cluster-prod` ne peuvent plus se réconcilier.
freeze_gitops() {
  log "gel d'ArgoCD (application-controller à 0 réplique) avant le pivot inverse"
  kprod -n argocd scale statefulset argocd-application-controller --replicas=0 \
    || warn "application-controller ArgoCD non gelé (absent ?) : poursuite"
}

delete_via_capi() {
  if [[ -s "$PROD_KUBECONFIG" ]] && has_cluster "$PROD_KUBECONFIG"; then
    log "pivot inverse : ${CLUSTER_NAME} -> kind"
    freeze_gitops
    ensure_kind
    capi_init "$KIND_KUBECONFIG"
    capi_wait_controllers "$KIND_KUBECONFIG"
    if ! has_cluster "$KIND_KUBECONFIG"; then
      clusterctl move --kubeconfig "$PROD_KUBECONFIG" --to-kubeconfig "$KIND_KUBECONFIG" -n "$CLUSTER_NS"
    fi
  elif kind get clusters 2>/dev/null | grep -qx "$KIND_CLUSTER_NAME"; then
    log "kind '${KIND_CLUSTER_NAME}' présent : réutilisation"
    kind export kubeconfig --name "$KIND_CLUSTER_NAME" --kubeconfig "$KIND_KUBECONFIG"
  else
    warn "aucun cluster de gestion joignable (ni ${PROD_KUBECONFIG}, ni kind)"
    return 1
  fi
  if has_cluster "$KIND_KUBECONFIG"; then
    log "suppression du Cluster ${CLUSTER_NAME} (les VMs Proxmox sont détruites par CAPMOX)"
    kkind -n "$CLUSTER_NS" delete cluster "$CLUSTER_NAME" --wait=true --timeout=30m
  fi
  wait_for 1800 "toutes les Machines supprimées" machines_gone
  kind delete cluster --name "$KIND_CLUSTER_NAME"
  rm -f "$KIND_KUBECONFIG" "$PROD_KUBECONFIG" "$PROD_TALOSCONFIG"
}

# Fallback : VMs du pool Kubernetes (plage vmid du contrat, hors templates) portant le tag $PROXMOX_VM_TAG.
# Le tag réellement posé par CAPMOX doit être vérifié dans l'UI Proxmox ; défaut : nom du cluster.
delete_via_proxmox_api() {
  require_cmd curl jq
  local tag="${PROXMOX_VM_TAG:-$CLUSTER_NAME}" base lo hi token list answer node vmid
  local insecure=()
  base="$(site_get proxmox_url)"
  base="${base%/}/api2/json"
  lo=$(contract '.kubernetes.vmid_range[0]')
  hi=$(contract '.kubernetes.vmid_range[1]')
  token=$(sops_get "$PROXMOX_SOPS" '["proxmox"]["api_token"]')
  if [[ "$(sops_get "$PROXMOX_SOPS" '["proxmox"]["insecure"]')" == "true" ]]; then insecure=(-k); fi
  # En-tête d'authentification passé par substitution de processus (absent de la liste des processus).
  pve() { # pve <méthode> <chemin>
    curl -fsS "${insecure[@]}" -X "$1" --config <(printf 'header = "Authorization: PVEAPIToken=%s"\n' "$token") "${base}$2"
  }
  list=$(pve GET "/cluster/resources?type=vm" | jq -r --arg tag "$tag" --argjson lo "$lo" --argjson hi "$hi" \
    '.data[] | select(.vmid >= $lo and .vmid <= $hi and ((.template // 0) == 0) and ((.tags // "") | split(";") | index($tag))) | "\(.node) \(.vmid) \(.name)"')
  if [[ -z "$list" ]]; then
    log "aucune VM avec le tag '${tag}' dans [${lo},${hi}]"
    return 0
  fi
  warn "VMs qui seront ARRÊTÉES et SUPPRIMÉES (purge des disques) :"
  printf '%s\n' "$list" >&2
  read -r -p "Taper 'detruire' pour confirmer : " answer
  [[ "$answer" == "detruire" ]] || die "annulé"
  while read -r node vmid _; do
    log "suppression VM ${vmid} (${node})"
    pve POST "/nodes/${node}/qemu/${vmid}/status/stop" >/dev/null || true
    sleep 5
    pve DELETE "/nodes/${node}/qemu/${vmid}?purge=1&destroy-unreferenced-disks=1" >/dev/null
  done <<<"$list"
  rm -f "$KIND_KUBECONFIG" "$PROD_KUBECONFIG" "$PROD_TALOSCONFIG"
}

load_proxmox_env
if ! delete_via_capi; then
  warn "suppression via Cluster API impossible ; fallback API Proxmox (confirmation requise)"
  delete_via_proxmox_api
fi
log "cluster ${CLUSTER_NAME} détruit"
