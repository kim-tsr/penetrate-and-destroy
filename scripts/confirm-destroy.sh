#!/usr/bin/env bash
# Garde-fou de `task destroy` / `task rebuild` : exige une confirmation explicite, jamais silencieuse.
#
# - Interactif : afficher ce qui sera détruit, puis demander de taper "destroy".
# - Non interactif (CI, script) : n'accepte que PAD_CONFIRM_DESTROY=destroy ; `task --yes` seul ne suffit pas.
# - Seules les ressources des stacks tofu et le cluster pad-prod sont supprimés (l'hôte Proxmox est conservé).
set -euo pipefail

# Argument facultatif : `cluster` (message limité au cluster) ; sans argument, destruction complète.
case "${1:-all}" in
  cluster)
    cat >&2 <<'MSG'
=== DESTRUCTION DU CLUSTER KUBERNETES ===
Sera détruit : le cluster pad-prod (VM Talos et données des volumes persistants).
Conservés : routeur, LXC de services, réseau, configurations Authentik / NetBird / Warpgate, DNS.
Les données (MariaDB de CTFd, buckets Garage) seront PERDUES : lancer `task backup` avant.
MSG
    ;;
  *)
    cat >&2 <<'MSG'
=== DESTRUCTION DE LA PLATEFORME ===
Seront détruits : cluster Kubernetes (pad-prod), LXC de services, VM routeur, règles et zones réseau,
configurations Authentik / NetBird / Warpgate, enregistrements DNS. L'hôte Proxmox est conservé.
Les données (MariaDB de CTFd, buckets Garage) seront PERDUES : lancer `task backup` avant.
MSG
    ;;
esac

if [ "${PAD_CONFIRM_DESTROY:-}" = destroy ]; then
  echo "Confirmation fournie par PAD_CONFIRM_DESTROY." >&2
  exit 0
fi
if [ ! -t 0 ]; then
  echo "Refus : pas de terminal pour confirmer. Définir PAD_CONFIRM_DESTROY=destroy pour une exécution non interactive." >&2
  exit 1
fi
printf 'Taper "destroy" pour confirmer : ' >&2
read -r answer
if [ "$answer" != destroy ]; then
  echo "Annulé." >&2
  exit 1
fi
