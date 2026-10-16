#!/usr/bin/env bash
# kustomize build + kubeconform de tout gitops/, SANS dépendre des vrais secrets (CI publique, poste sans clé).
#
# Problème : chaque composant à secret référence un secret.sops.yaml que seul l'opérateur peut produire (clé age privée
# hors repo) ; sans lui, `kustomize build` (ksops) échoue. Solution : travailler sur une COPIE temporaire de gitops/ où
# tous les *.sops.yaml sont (re)générés à partir des *.example.yaml et chiffrés avec une clé age ÉPHÉMÈRE créée pour
# l'occasion (supprimée en sortie). La vraie clé n'est jamais lue, les vrais *.sops.yaml du repo ne sont ni lus ni modifiés.
# Les Secrets rendus portent donc les valeurs CHANGEME de l'exemple : seule la forme du manifeste est validée.
#
# Usage : scripts/validate-gitops.sh [dossier-kustomize...]   (défaut : tous les dossiers gitops/**/kustomization.yaml)
# Variables : KUBECONFORM_SCHEMAS=<url> pour surcharger le catalogue de CRDs ; KUSTOMIZE_FLAGS pour des options en plus.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for t in age-keygen sops ksops kustomize kubeconform; do
  command -v "$t" >/dev/null 2>&1 || { echo "outil manquant : $t (nix develop)" >&2; exit 2; }
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"
cp -a "$ROOT/gitops" "$TMP/gitops"
# Aucun secret réel dans la copie ; ni clé réelle dans l'environnement de sops/ksops.
find "$TMP/gitops" -name '*.sops.yaml' -delete
unset SOPS_AGE_KEY SOPS_AGE_KEY_CMD
export XDG_CONFIG_HOME="$TMP/xdg"
age-keygen -o "$TMP/ci.agekey" 2>/dev/null
chmod 600 "$TMP/ci.agekey"
export SOPS_AGE_KEY_FILE="$TMP/ci.agekey"
pub="$(age-keygen -y "$TMP/ci.agekey")"

cd "$TMP"
count=0
while IFS= read -r ex; do
  out="${ex%.example.yaml}.sops.yaml"
  # shellcheck disable=SC2094  # --filename-override ne lit pas le fichier : il sert seulement à choisir la règle
  sops --encrypt --age "$pub" --encrypted-regex '^(data|stringData)$' --input-type yaml --output-type yaml \
    --filename-override "$out" /dev/stdin <"$ex" >"$out"
  count=$((count + 1))
done < <(find gitops -name '*.example.yaml' -not -path '*/node_modules/*' | sort)
echo "sops factices (clé éphémère) : ${count}"

if (($# > 0)); then
  mapfile -t dirs < <(printf '%s\n' "$@" | sed 's|/$||')
else
  mapfile -t dirs < <(find gitops -name kustomization.yaml -not -path '*/node_modules/*' -exec dirname {} \; | sort)
fi

schema_catalog='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
schema_catalog="${KUBECONFORM_SCHEMAS:-$schema_catalog}"
fail=0
for d in "${dirs[@]}"; do
  echo "==> $d"
  # shellcheck disable=SC2086  # KUSTOMIZE_FLAGS : options multiples volontaires
  if ! kustomize build --enable-alpha-plugins --enable-exec ${KUSTOMIZE_FLAGS:-} "$d" \
    | kubeconform -strict -ignore-missing-schemas -summary -schema-location default -schema-location "$schema_catalog"; then
    echo "KO: $d"
    fail=1
  fi
done
exit "$fail"
