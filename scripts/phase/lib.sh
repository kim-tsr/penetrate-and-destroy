#!/usr/bin/env bash
# Bibliothèque des vérifications de phase (scripts/phase/check.sh, status.sh). À sourcer, jamais à exécuter.
#
# Tout est en LECTURE SEULE : appels GET de l'API Proxmox, commandes d'observation en SSH, kubectl get. Aucune valeur
# secrète n'est affichée ni écrite sur disque (le jeton Proxmox passe par une substitution de processus).
# shellcheck shell=bash disable=SC2034,SC2029

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS="${ROOT_DIR}/infra/contracts.yaml"
STATE_DIR="${STATE_DIR:-${ROOT_DIR}/.state}"
TOFU_STATE_DIR="${STATE_DIR}/tofu"
PROD_KUBECONFIG="${STATE_DIR}/kubeconfig"
PROD_TALOSCONFIG="${STATE_DIR}/talosconfig"
KIND_KUBECONFIG="${STATE_DIR}/kind.kubeconfig"

N_OK=0
N_KO=0
N_WARN=0

if [[ -t 1 ]]; then
  C_OK=$'\033[32m' C_KO=$'\033[31m' C_WARN=$'\033[33m' C_DIM=$'\033[2m' C_END=$'\033[0m'
else
  C_OK="" C_KO="" C_WARN="" C_DIM="" C_END=""
fi

section() { printf '\n== %s\n' "$*"; }
pass() { N_OK=$((N_OK + 1)); printf '%sOK%s    %s\n' "$C_OK" "$C_END" "$1"; }
# fail <constat> [que regarder]
fail() {
  N_KO=$((N_KO + 1))
  printf '%sKO%s    %s\n' "$C_KO" "$C_END" "$1"
  [[ -z "${2:-}" ]] || printf '      %s-> à regarder : %s%s\n' "$C_DIM" "$2" "$C_END"
}
# warn <constat> [que regarder] : non bloquant (non vérifiable d'ici, ou facultatif)
warn() {
  N_WARN=$((N_WARN + 1))
  printf '%sWARN%s  %s\n' "$C_WARN" "$C_END" "$1"
  [[ -z "${2:-}" ]] || printf '      %s-> %s%s\n' "$C_DIM" "$2" "$C_END"
}
info() { printf '      %s%s%s\n' "$C_DIM" "$*" "$C_END"; }

have() { command -v "$1" >/dev/null 2>&1; }

# summary <nom de la phase> : affiche le bilan ; code retour 1 s'il y a des KO (sauf PAD_CHECK_MODE=warn).
summary() {
  printf '\n'
  if ((N_KO == 0)); then
    printf '%sRésultat %s : OK%s (%d OK, %d avertissement(s))\n' "$C_OK" "$1" "$C_END" "$N_OK" "$N_WARN"
    # Les tâches phase:* (PAD_MARK=1) consignent la réussite pour `task status`.
    if [[ "${PAD_MARK:-}" == 1 ]]; then bash "${ROOT_DIR}/scripts/phase/mark.sh" set "$1"; fi
    return 0
  fi
  printf '%sRésultat %s : KO%s (%d OK, %d KO, %d avertissement(s))\n' "$C_KO" "$1" "$C_END" "$N_OK" "$N_KO" "$N_WARN"
  if [[ "${PAD_CHECK_MODE:-strict}" == warn ]]; then
    printf 'PAD_CHECK_MODE=warn : les KO ne bloquent pas l'"'"'enchaînement.\n'
    return 0
  fi
  return 1
}

# --- contrat ---------------------------------------------------------------------------------------------------------
# c '.kubernetes.cluster_name'
c() { yq -r "$1" "$CONTRACTS"; }

# --- valeurs de site et jeton Proxmox (déchiffrés en mémoire, jamais sur disque) ---------------------------------------
SITE_YAML=""
PVE_TOKEN=""
PVE_INSECURE=""

site_load() {
  [[ -n "$SITE_YAML" ]] && return 0
  [[ -f "${ROOT_DIR}/secrets/site.sops.yaml" ]] || return 1
  SITE_YAML=$(sops --decrypt --output-type yaml "${ROOT_DIR}/secrets/site.sops.yaml" 2>/dev/null) || {
    SITE_YAML=""
    return 1
  }
}
# site_get proxmox_url | ssh_host | ssh_user | wan.ip ...  (vide si absent)
site_get() {
  site_load || return 1
  printf '%s' "$SITE_YAML" | yq -r ".$1 // \"\""
}

pve_load() {
  [[ -n "$PVE_TOKEN" ]] && return 0
  [[ -f "${ROOT_DIR}/secrets/proxmox.sops.yaml" ]] || return 1
  PVE_TOKEN=$(sops --decrypt --extract '["proxmox"]["api_token"]' "${ROOT_DIR}/secrets/proxmox.sops.yaml" 2>/dev/null) || return 1
  PVE_INSECURE=$(sops --decrypt --extract '["proxmox"]["insecure"]' "${ROOT_DIR}/secrets/proxmox.sops.yaml" 2>/dev/null || echo true)
  [[ -n "$PVE_TOKEN" ]]
}

# pve_get <chemin> : GET sur l'API Proxmox, JSON sur stdout (échec si injoignable ou refusé).
pve_get() {
  local url insecure=()
  url=$(site_get proxmox_url) && [[ -n "$url" ]] || return 1
  pve_load || return 1
  [[ "$PVE_INSECURE" == true ]] && insecure=(-k)
  curl -fsS --max-time 20 "${insecure[@]}" \
    --config <(printf 'header = "Authorization: PVEAPIToken=%s"\n' "$PVE_TOKEN") \
    "${url%/}/api2/json$1"
}

NODE="" # rempli à la demande
node() { [[ -n "$NODE" ]] || NODE=$(c '.host.node'); printf '%s' "$NODE"; }

# vm_status <vmid> <qemu|lxc> : "running", "stopped"... ou vide si la VM/le LXC n'existe pas.
vm_status() {
  pve_get "/nodes/$(node)/$2/$1/status/current" 2>/dev/null | jq -r '.data.status // ""' 2>/dev/null || true
}

# --- SSH (hôte Proxmox, puis LXC via l'hôte comme le fait Ansible) -----------------------------------------------------
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=10)

host_target() {
  local u h
  u=$(site_get ssh_user) && h=$(site_get ssh_host) && [[ -n "$u" && -n "$h" ]] || return 1
  printf '%s@%s' "$u" "$h"
}
# host_ssh <commande...> : sur l'hôte Proxmox
host_ssh() {
  local t
  t=$(host_target) || return 1
  ssh "${SSH_OPTS[@]}" "$t" "$@"
}
# lxc_ssh <ip> <commande...> : dans un LXC, par rebond sur l'hôte (PAD_PROXMOX_JUMP surcharge, comme pour Ansible)
lxc_ssh() {
  local ip=$1 jump
  shift
  jump="${PAD_PROXMOX_JUMP:-$(host_target)}" || return 1
  # Rebond multiplexé (même raison que dans l'inventaire Ansible : PerSourcePenalties d'OpenSSH >= 9.8 sur l'hôte).
  mkdir -p "${HOME}/.ansible/cp"
  ssh "${SSH_OPTS[@]}" -o "ProxyCommand=ssh -o BatchMode=yes -o ControlMaster=auto -o ControlPersist=300 -o ControlPath=${HOME}/.ansible/cp/pad-jump-check -W %h:%p ${jump}" "root@${ip}" "$@"
}

# --- état OpenTofu -----------------------------------------------------------------------------------------------------
# stack_has_state <stack> : un state non vide existe (le contenu est chiffré : on ne juge que sa présence).
stack_has_state() {
  [[ -s "${TOFU_STATE_DIR}/$1.tfstate" ]]
}

# Résout les valeurs de contrat souvent utilisées.
svc_ip() { c ".services.$1.ip"; }
svc_vmid() { c ".services.$1.vmid"; }
fqdn() { printf '%s.%s' "$(c ".hostnames.$1")" "$(c '.domain')"; }

# kprod <args kubectl> : kubectl contre pad-prod, timeout court (lecture seule).
kprod() { kubectl --kubeconfig "$PROD_KUBECONFIG" --request-timeout=15s "$@"; }

# need_for_check <outil>... : KO unique si un outil manque (retourne 1).
need_for_check() {
  local t miss=()
  for t in "$@"; do have "$t" || miss+=("$t"); done
  if ((${#miss[@]} > 0)); then
    fail "outil(s) manquant(s) : ${miss[*]}" "lancer 'nix develop' (voir docs/guide-deploiement.md)"
    return 1
  fi
}
