#!/usr/bin/env bash
# Alias historique : change le nom du nœud Proxmox (host.node). Voir scripts/site-set.py pour toutes les valeurs de site.
#
# Usage : scripts/site-node.sh <nom-du-noeud>      (via `task site:node -- <nom-du-noeud>`)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
new="${1:-}"
[[ "$new" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo "usage : $0 <nom-du-noeud>  (minuscules, chiffres et tirets ; nom du node Proxmox, cf. « hostname »)" >&2
  exit 2
}
exec python3 -I "${ROOT}/scripts/site-set.py" "node=${new}"
