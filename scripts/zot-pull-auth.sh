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
  -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' | grep -v '^$')
((${#ips[@]})) || die "aucun nœud ${pool_label} (pool challenges à 0 ?)"

patch_for() { # patch YAML (stdout) ; le mot de passe n'apparaît que dans le pipe
  local pw
  pw=$(sops_get "$creds" '["zot_pad_pull_password"]')
  printf '%s\n' "machine:" "  registries:" "    config:" "      ${registry}:" "        auth:" \
    "          username: pad-pull" "          password: ${pw}"
}

tctl() { local ip=$1; shift; talosctl --talosconfig "$PROD_TALOSCONFIG" -n "$ip" -e "$ip" "$@"; }
# Identifiants déjà posés ? Comparaison en mémoire (rien n'est affiché) : la version de la configuration Talos change à
# chaque patch, même identique, et ne peut donc pas servir de témoin.
up_to_date() {
  local cur want
  cur=$(tctl "$1" get machineconfig -o yaml 2>/dev/null \
    | yq ".spec | from_yaml | .machine.registries.config[\"${registry}\"].auth | .username + \":\" + .password" 2>/dev/null) || return 1
  want="pad-pull:$(sops_get "$creds" '["zot_pad_pull_password"]')"
  [[ "$cur" == "$want" ]]
}

for ip in "${ips[@]}"; do
  if up_to_date "$ip"; then
    log "nœud ${ip} : identifiants déjà posés, rien à faire"
    continue
  fi
  log "nœud ${ip} : identifiants pad-pull pour ${registry}"
  tctl "$ip" patch machineconfig --mode no-reboot --patch @<(patch_for)
  # containerd ne relit les identifiants de registre qu'à son démarrage (constaté : « no basic auth credentials » tant que
  # le nœud n'a pas redémarré) : redémarrage, seulement quand les identifiants viennent d'être posés.
  warn "nœud ${ip} : redémarrage pour que containerd charge les identifiants (instances du nœud interrompues)"
  tctl "$ip" reboot --wait --timeout 10m
done
log "${#ips[@]} nœud(s) challenges à jour."
