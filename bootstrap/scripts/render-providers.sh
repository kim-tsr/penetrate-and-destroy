#!/usr/bin/env bash
# Rend les manifests des providers Cluster API (versions du contrat) dans
# gitops/platform/capi-providers/manifests/, pour qu'ArgoCD les gère après le pivot.
#
# Approche (documentée dans gitops/platform/capi-providers/README.md) :
# - `clusterctl generate provider` produit exactement ce que `clusterctl init` applique ;
# - les variables sont fixées ici (pas de feature gates expérimentales) ;
# - le Secret d'identifiants CAPMOX est retiré (il vient de gitops/platform/secrets via ksops) ;
# - l'inventaire clusterctl (objets Provider) est généré pour rester cohérent avec
#   `clusterctl move` / `clusterctl upgrade plan`.
# Mise à jour : modifier kubernetes.capi.* dans le contrat, relancer `task bootstrap:render-providers`, committer.
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

require_cmd clusterctl yq

OUT="${PLATFORM_DIR}/capi-providers/manifests"
mkdir -p "$OUT"

# Variables neutres : aucune valeur sensible n'est rendue (le Secret est supprimé ci-dessous).
export PROXMOX_URL="https://placeholder.invalid:8006" PROXMOX_TOKEN="placeholder" PROXMOX_SECRET="placeholder"
export CLUSTER_TOPOLOGY=false EXP_MACHINE_POOL=false EXP_RUNTIME_SDK=false CAPMOX_LOGLEVEL=2
export CLUSTERCTL_DISABLE_VERSIONCHECK=true

core=$(contract '.kubernetes.capi.core')
cabpt=$(contract '.kubernetes.capi.bootstrap_talos')
cacppt=$(contract '.kubernetes.capi.control_plane_talos')
capmox=$(contract '.kubernetes.capi.infrastructure_proxmox')
ipam=$(contract '.kubernetes.capi.ipam_in_cluster')

render() { # render <fichier> <flag> <provider:version>
  log "clusterctl generate provider $2 $3"
  clusterctl generate provider "$2" "$3" --config "${ROOT_DIR}/bootstrap/clusterctl.yaml" \
    | yq 'select(.kind != "Secret" or .metadata.name != "capmox-manager-credentials")' >"${OUT}/$1.tmp"
  {
    printf '# Généré par bootstrap/scripts/render-providers.sh (%s) - ne pas éditer à la main.\n' "$3"
    cat "${OUT}/$1.tmp"
  } >"${OUT}/$1"
  rm -f "${OUT}/$1.tmp"
}

render core-cluster-api.yaml --core "cluster-api:${core}"
render bootstrap-talos.yaml --bootstrap "talos:${cabpt}"
render control-plane-talos.yaml --control-plane "talos:${cacppt}"
render infrastructure-proxmox.yaml --infrastructure "proxmox:${capmox}"
render ipam-in-cluster.yaml --ipam "in-cluster:${ipam}"

# Inventaire clusterctl (même forme que celui créé par `clusterctl init`).
inventory() { # inventory <name> <namespace> <providerName> <type> <version>
  cat <<EOF
---
apiVersion: clusterctl.cluster.x-k8s.io/v1alpha3
kind: Provider
metadata:
  name: $1
  namespace: $2
  labels:
    clusterctl.cluster.x-k8s.io: ""
    cluster.x-k8s.io/provider: $1
providerName: $3
type: $4
version: $5
EOF
}
{
  echo "# Généré par bootstrap/scripts/render-providers.sh - inventaire clusterctl."
  inventory cluster-api capi-system cluster-api CoreProvider "$core"
  inventory bootstrap-talos cabpt-system talos BootstrapProvider "$cabpt"
  inventory control-plane-talos cacppt-system talos ControlPlaneProvider "$cacppt"
  inventory infrastructure-proxmox capmox-system proxmox InfrastructureProvider "$capmox"
  inventory ipam-in-cluster capi-ipam-in-cluster-system in-cluster IPAMProvider "$ipam"
} >"${OUT}/inventory.yaml"

log "manifests rendus dans ${OUT}"
