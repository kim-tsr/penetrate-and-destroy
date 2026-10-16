#!/usr/bin/env bash
# État du déploiement : quelles phases semblent faites ?
#
#   scripts/phase/status.sh          rapide, hors ligne : états tofu (.state/tofu) et marqueurs de phase (.state/phases)
#   scripts/phase/status.sh --live   joue en plus chaque `check:<phase>` (lecture seule, plus lent, contacte l'hôte)
#
# Un marqueur est écrit par `task phase:<phase>` quand sa vérification réussit, et effacé par les destructions.
set -uo pipefail
# shellcheck source=scripts/phase/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

live=0
[[ "${1:-}" == --live ]] && live=1
PHASE_DIR="${STATE_DIR}/phases"

# phase -> stacks tofu associées
declare -A STACKS=(
  [1-reseau]="00-host-network" [2-routeur]="10-router 60-opnsense-rules" [3-image-talos]="15-talos-image"
  [4-lxc]="20-services-lxc" [5-dns]="70-dns" [7-identite]="30-authentik" [11-acces]="40-netbird 50-warpgate"
)
PHASES=(0-prereqs 1-reseau 2-routeur 3-image-talos 4-lxc 5-dns 6-services-1 7-identite 8-services-2 9-cluster 10-gitops 11-acces 12-verify)

printf '%-16s %-10s %s\n' PHASE ÉTAT DÉTAIL
for p in "${PHASES[@]}"; do
  detail=""
  marker="absent"
  [[ -f "${PHASE_DIR}/${p}.ok" ]] && marker="vérifiée le $(cat "${PHASE_DIR}/${p}.ok")"
  have_st=0
  want_st=0
  for s in ${STACKS[$p]:-}; do
    want_st=$((want_st + 1))
    stack_has_state "$s" && have_st=$((have_st + 1))
  done
  if ((want_st > 0)); then detail="states tofu ${have_st}/${want_st} ; "; fi
  detail+="marqueur : ${marker}"
  case "$p" in
    9-cluster) [[ -s "$PROD_KUBECONFIG" ]] && detail+=" ; kubeconfig présent" ;;
    4-lxc) [[ -s "${ROOT_DIR}/infra/ansible/inventories/prod/hosts.generated.yml" ]] && detail+=" ; inventaire généré" ;;
  esac
  if [[ -f "${PHASE_DIR}/${p}.ok" ]]; then state=faite
  elif ((have_st > 0)) || { [[ "$p" == 9-cluster ]] && [[ -s "$PROD_KUBECONFIG" ]]; }; then state=partielle
  else state="à faire"; fi
  if ((live)); then
    if out=$(PAD_CHECK_MODE=strict bash "$(dirname "${BASH_SOURCE[0]}")/check.sh" "$p" 2>&1); then live_s="check OK"; else live_s="check KO"; fi
    detail+=" ; ${live_s}"
    [[ "$live_s" == "check OK" && "$state" != faite ]] && state="faite (live)"
    [[ "$live_s" == "check KO" && "$state" == faite ]] && state="DÉGRADÉE"
    : "$out"
  fi
  printf '%-16s %-10s %s\n' "$p" "$state" "$detail"
done
echo
echo "Détail d'une phase : task check:<phase> (ex. task check:4-lxc). Plan sans appliquer : task plan:<stack>."
