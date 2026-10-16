#!/usr/bin/env bash
# Repartir VRAIMENT de zéro côté poste opérateur : efface l'état local laissé par un déploiement (après `task destroy`).
#
#   scripts/phase/purge-state.sh [--force] [--backups]     (via `task state:purge`)
#
# Supprimé : .state/tofu (states chiffrés, états orphelins), .state/phases, .state/kubeconfig, .state/talosconfig,
#            .state/kind.kubeconfig, .state/opnsense (ISO de configuration rendus), .state/ansible-facts,
#            l'inventaire généré infra/ansible/inventories/prod/hosts.generated.yml.
# Conservé : les clés age (hors dépôt), les *.sops.yaml (dans Git), .state/backups (sauf --backups), les caches
#            .terraform/ et .collections/ (téléchargements).
# Refus si un state tofu non vide existe encore (des ressources existent peut-être) : `task destroy` d'abord, ou --force
# pour les abandonner (elles resteront alors sur l'hôte, à supprimer à la main).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="${ROOT_DIR}/.state"
force=0
backups=0
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    --backups) backups=1 ;;
    *) echo "usage : $0 [--force] [--backups]" >&2; exit 2 ;;
  esac
done

left=()
for f in "${S}"/tofu/*.tfstate; do
  [[ -s "$f" ]] && left+=("$(basename "$f" .tfstate)")
done
if ((${#left[@]} > 0 && force == 0)); then
  echo "Refus : des states tofu non vides existent encore (${left[*]})." >&2
  echo "Lancer d'abord 'task destroy' (ou 'task state:purge -- --force' pour les abandonner : les ressources resteront sur l'hôte)." >&2
  exit 1
fi

if [[ -z "${PAD_CONFIRM_PURGE:-}" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Refus : pas de terminal. PAD_CONFIRM_PURGE=purge pour une exécution non interactive." >&2
    exit 1
  fi
  printf 'Effacer l'"'"'état local (.state/tofu, kubeconfig, marqueurs...) ? Taper "purge" : ' >&2
  read -r answer
  [[ "$answer" == purge ]] || { echo "Annulé." >&2; exit 1; }
elif [[ "$PAD_CONFIRM_PURGE" != purge ]]; then
  echo "PAD_CONFIRM_PURGE doit valoir « purge »." >&2
  exit 1
fi

rm -rf "${S}/tofu" "${S}/phases" "${S}/opnsense" "${S}/ansible-facts"
rm -f "${S}/kubeconfig" "${S}/talosconfig" "${S}/kind.kubeconfig"
rm -f "${ROOT_DIR}/infra/ansible/inventories/prod/hosts.generated.yml"
if ((backups)); then rm -rf "${S}/backups"; fi
echo "État local effacé. Conservés : clés age, secrets chiffrés (Git)$([[ $backups -eq 1 ]] || echo ', .state/backups')."
echo "Repartir : task phase:0-prereqs puis les phases, ou task up."
