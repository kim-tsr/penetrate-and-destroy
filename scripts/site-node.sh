#!/usr/bin/env bash
# Change le nom du nœud Proxmox (défaut : pve) : met à jour infra/contracts.yaml (host.node) et toutes les lignes
# du repo qui portent le marqueur `# contracts: host.node` (manifests gitops). Idempotent.
#
# Usage : scripts/site-node.sh <nom-du-noeud>      (via `task site:node -- <nom-du-noeud>`)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

new="${1:-}"
[[ "$new" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo "usage : $0 <nom-du-noeud>  (minuscules, chiffres et tirets ; nom du node Proxmox, cf. « hostname »)" >&2
  exit 2
}

old=$(sed -nE 's/^  node:[[:space:]]+([a-z0-9-]+).*/\1/p' infra/contracts.yaml | head -n1)
[[ -n "$old" ]] || { echo "host.node introuvable dans infra/contracts.yaml" >&2; exit 1; }
if [[ "$old" == "$new" ]]; then
  echo "host.node vaut déjà '$new' : rien à faire"
  exit 0
fi

sed -i -E "s/^(  node:[[:space:]]+)${old}([[:space:]]|\$)/\1${new}\2/" infra/contracts.yaml

# Lignes marquées : le nom n'est remplacé que comme mot entier (ni dans « pve-exporter », ni dans « csi@pve »).
mapfile -t files < <(grep -rIl --exclude-dir=.git --exclude-dir=node_modules -- '# contracts: host\.node' gitops)
for f in "${files[@]}"; do
  sed -i -E "/# contracts: host\.node/ s/(^|[^[:alnum:]_.@!-])${old}([^[:alnum:]_.@!-]|\$)/\1${new}\2/g" "$f"
  echo "mis à jour : $f"
done
echo "host.node : ${old} -> ${new} (contrat + ${#files[@]} fichier(s)). Relancer : bash scripts/validate-gitops.sh"
