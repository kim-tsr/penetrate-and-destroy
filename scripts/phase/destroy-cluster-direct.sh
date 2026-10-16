#!/usr/bin/env bash
# Destruction DIRECTE du cluster pad-prod, sans Cluster API : supprime les VM Kubernetes par l'API Proxmox.
#
# À utiliser quand le cluster est cassé (API injoignable, CAPI hors service, pivot impossible) : `task cluster:destroy-force`.
# Cible : VM de la plage vmid du contrat, hors templates, portant le tag du cluster (posé par CAPMOX).
# La confirmation forte est exigée en amont (scripts/confirm-destroy.sh). Les VM sont arrêtées puis supprimées avec leurs disques.
# Les volumes persistants du CSI (pvc-*) ne sont PAS supprimés : `task check:cluster-detruit` les liste.
set -euo pipefail
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../bootstrap/scripts/lib.sh"
require_cmd curl jq sops yq

tag=$(contract '.kubernetes.cluster_name')
lo=$(contract '.kubernetes.vmid_range[0]')
hi=$(contract '.kubernetes.vmid_range[1]')
base="$(site_get proxmox_url)"
base="${base%/}/api2/json"
token=$(sops_get "${ROOT_DIR}/secrets/proxmox.sops.yaml" '["proxmox"]["api_token"]')
insecure=()
if [[ "$(sops_get "${ROOT_DIR}/secrets/proxmox.sops.yaml" '["proxmox"]["insecure"]')" == "true" ]]; then insecure=(-k); fi
pve() { # pve <méthode> <chemin>
  curl -fsS "${insecure[@]}" -X "$1" --config <(printf 'header = "Authorization: PVEAPIToken=%s"\n' "$token") "${base}$2"
}

list=$(pve GET "/cluster/resources?type=vm" | jq -r --arg tag "$tag" --argjson lo "$lo" --argjson hi "$hi" \
  '.data[] | select(.vmid >= $lo and .vmid <= $hi and ((.template // 0) == 0) and ((.tags // "") | split(";") | index($tag))) | "\(.node) \(.vmid) \(.name)"')
if [[ -n "$list" ]]; then
  warn "VM supprimées (arrêt puis suppression avec les disques) :"
  printf '%s\n' "$list" >&2
  while read -r node vmid _; do
    log "arrêt puis suppression de la VM ${vmid} (${node})"
    pve POST "/nodes/${node}/qemu/${vmid}/status/stop" >/dev/null || true
    for _ in $(seq 1 12); do
      [[ "$(pve GET "/nodes/${node}/qemu/${vmid}/status/current" | jq -r '.data.status')" == stopped ]] && break
      sleep 5
    done
    pve DELETE "/nodes/${node}/qemu/${vmid}?purge=1&destroy-unreferenced-disks=1" >/dev/null
  done <<<"$list"
else
  log "aucune VM étiquetée '${tag}' dans [${lo},${hi}]"
fi

if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$KIND_CLUSTER_NAME"; then
  log "suppression du cluster kind résiduel"
  kind delete cluster --name "$KIND_CLUSTER_NAME"
fi
rm -f "$KIND_KUBECONFIG" "$PROD_KUBECONFIG" "$PROD_TALOSCONFIG"
log "cluster ${tag} supprimé (VM, kubeconfig, talosconfig). Vérifier : task check:cluster-detruit"
