#!/usr/bin/env bash
# Détruit une stack tofu en tolérant l'absence de state et, au besoin, une API de service déjà disparue.
#
#   scripts/phase/destroy-stack.sh <stack> [strict|tolerant]
#
# - Stack absente ou sans state : rien à faire, code 0 (un state manquant ne bloque jamais l'enchaînement).
# - strict (défaut) : un échec de `tofu destroy` arrête tout (stacks qui parlent à l'API Proxmox ou à un service externe :
#   un échec y signifie des ressources encore présentes).
# - tolerant : pour les stacks qui configurent un service détruit juste après (Authentik, NetBird, Warpgate, règles OPNsense),
#   un échec (service injoignable, jeton invalide) met le state de côté dans .state/tofu/orphelins/ et continue : les ressources
#   vivaient dans le service qui va disparaître.
# La confirmation est demandée une fois en amont par scripts/confirm-destroy.sh.
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stack=${1:?stack}
mode=${2:-strict}
dir="${ROOT_DIR}/infra/tofu/stacks/${stack}"
state="${ROOT_DIR}/.state/tofu/${stack}.tfstate"

if [[ ! -d "$dir" || ! -s "$state" ]]; then
  echo "[${stack}] pas de state : rien à détruire"
  exit 0
fi
if [[ -z "${TF_VAR_state_passphrase:-}" ]]; then
  echo "[${stack}] TF_VAR_state_passphrase doit être défini (sans lui le state chiffré est illisible)" >&2
  exit 1
fi
echo "[${stack}] tofu destroy (${mode})"
if tofu -chdir="$dir" init -input=false >/dev/null && tofu -chdir="$dir" destroy -input=false -auto-approve; then
  exit 0
fi
if [[ "$mode" == tolerant ]]; then
  mkdir -p "${ROOT_DIR}/.state/tofu/orphelins"
  dest="${ROOT_DIR}/.state/tofu/orphelins/${stack}.$(date +%Y%m%d%H%M%S).tfstate"
  mv "$state" "$dest"
  rm -f "${state}.backup"
  echo "[${stack}] WARN destruction impossible via l'API (service déjà détruit ou injoignable) : state mis de côté (${dest#"${ROOT_DIR}"/}), on continue." >&2
  exit 0
fi
echo "[${stack}] ERREUR destroy échoué. Corriger la cause puis relancer (idempotent) ; dernier recours : supprimer à la main les invités concernés (qm/pct destroy) puis retirer .state/tofu/${stack}.tfstate" >&2
exit 1
