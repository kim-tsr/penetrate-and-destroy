#!/usr/bin/env bash
# Garde-fou de `task destroy` / `task rebuild` : exige une confirmation explicite, jamais silencieuse.
#
# - Interactif : afficher ce qui sera détruit, puis demander de taper "destroy".
# - Non interactif (CI, script) : n'accepte que PAD_CONFIRM_DESTROY=destroy ; `task --yes` seul ne suffit pas.
# - Seules les ressources des stacks tofu et le cluster pad-prod sont supprimés (l'hôte Proxmox est conservé).
set -euo pipefail

cat >&2 <<'MSG'
=== DESTRUCTION DE LA PLATEFORME ===
Seront détruits : cluster Kubernetes (pad-prod), LXC de services, VM routeur, règles et zones réseau,
configurations Authentik / NetBird / Warpgate, enregistrements DNS. L'hôte Proxmox est conservé.
Les données (MariaDB de CTFd, buckets Garage) seront PERDUES : lancer `task backup` avant.
MSG

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
