#!/usr/bin/env bash
# Identifiants de pull Zot (compte pad-pull, dépôt ctf/**) sur chaque nœud du pool challenges : `task zot:pull-auth`.
#
# Hors Git par construction : le dépôt est public et Cluster API ne déchiffre pas SOPS, donc le TalosConfigTemplate ne
# peut pas porter le mot de passe. On patche la configuration machine de chaque nœud par l'API Talos, le mot de passe
# passant par une substitution de processus (jamais écrit sur disque, jamais affiché).
# Idempotent : rejouer après chaque nouveau nœud (autoscaler, remplacement). Voir docs/operations/actions-post-deploiement.md (action 8).
set -euo pipefail
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/../bootstrap/scripts/lib.sh"
require_cmd kubectl talosctl sops yq

registry=$(contract '.apps.registry')
pool_label="pad.io/pool=challenges"
creds="${ROOT_DIR}/secrets/credentials.sops.yaml"
[[ -f "$creds" ]] || die "manquant : ${creds} (task secrets:init)"

mapfile -t ips < <(kprod get nodes -l "$pool_label" \
  -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}')
((${#ips[@]})) || die "aucun nœud ${pool_label} (pool challenges à 0 ?)"

patch_for() { # patch YAML (stdout) ; le mot de passe n'apparaît que dans le pipe
  local pw
  pw=$(sops_get "$creds" '["zot_pad_pull_password"]')
  printf '%s\n' "machine:" "  registries:" "    config:" "      ${registry}:" "        auth:" \
    "          username: pad-pull" "          password: ${pw}"
}

for ip in "${ips[@]}"; do
  [[ -n "$ip" ]] || continue
  log "nœud ${ip} : identifiants pad-pull pour ${registry}"
  talosctl --talosconfig "$PROD_TALOSCONFIG" -n "$ip" -e "$ip" patch machineconfig --mode auto --patch @<(patch_for)
done
log "${#ips[@]} nœud(s) challenges à jour. Si un pull ctf/ répond encore 401 : talosctl -n <ip> reboot (containerd relit la config au démarrage)."
