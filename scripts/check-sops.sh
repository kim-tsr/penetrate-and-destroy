#!/usr/bin/env bash
# Garde-fou statique des secrets (aucune clé requise, sûr en CI publique et en pre-commit) :
#   1. tout *.sops.yaml/yml/json suivi par git porte un bloc `sops:` complet (recipient age, mac) ;
#   2. aucune valeur non chiffrée (ENC[...]) : dans data/stringData pour gitops/ et les Secret Kubernetes, dans tout le
#      fichier pour secrets/ et infra/ (leurs règles .sops.yaml chiffrent toutes les valeurs) ;
#   3. aucun recipient age CHANGEME dans un fichier chiffré ;
#   4. aucun fichier de clé/déchiffré suivi (keys.txt, *.agekey, *.decrypted.*, *.dec.yaml), aucune clé privée age ;
#   5. aucun manifeste `kind: Secret` en clair (hors *.example.yaml et *.sops.yaml, hors templates Helm).
# Les valeurs ne sont JAMAIS affichées : uniquement fichier:ligne et nom de la clé.
#
# Usage : scripts/check-sops.sh [fichier...]   (sans argument : tous les fichiers suivis par git)
# Pre-commit (facultatif, voir docs/SECRETS.md) : ln -s ../../scripts/check-sops.sh .git/hooks/pre-commit
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
ko() { printf 'KO %s\n' "$*"; fail=1; }

if (($# > 0)); then
  files=("$@")
elif git rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -t files < <(git ls-files)
else
  mapfile -t files < <(find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's|^\./||')
fi

# Contrôle des valeurs d'un fichier YAML chiffré. $1 = fichier, $2 = "block" (data/stringData seulement) ou "all".
check_values() {
  awk -v file="$1" -v mode="$2" '
    /^sops:/ { exit }
    /^[ \t]*#/ || /^[ \t]*$/ || /^---/ { next }
    /^[^ \t-]/ {
      top = $0; sub(/:.*/, "", top)
      inblock = (mode == "all") || (top == "data" || top == "stringData")
      if (mode == "all" && top != "sops") { check($0, top) }
      next
    }
    inblock { check($0, "") }
    function check(line, topkey,   key, val) {
      key = line; val = line
      if (topkey != "") { sub(/^[^:]*:[ \t]*/, "", val); key = topkey }
      else {
        sub(/^[ \t]*-?[ \t]*/, "", key); sub(/:.*/, "", key)
        if (line ~ /^[ \t]*-[ \t]+[^:]*$/ || line ~ /^[ \t]*-[ \t]+[^:]*:[^ ]/) { val = line; sub(/^[ \t]*-[ \t]+/, "", val) }
        else { sub(/^[^:]*:[ \t]*/, "", val) }
      }
      # SOPS laisse les chaînes vides en clair ("" ou '') : rien à chiffrer.
      if (val == "" || val == "{}" || val == "[]" || val == "\"\"" || val == "\047\047") return
      if (val !~ /^ENC\[AES256_GCM,/) printf "KO %s:%d : valeur non chiffrée pour la clé \"%s\"\n", file, NR, key
    }
  ' "$1"
}

for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  base="${f##*/}"

  # 4. fichiers de clés / déchiffrés
  case "$base" in
    keys.txt | *.agekey | *.decrypted.* | *.dec.yaml | *.dec.yml | *.dec.json) ko "$f : fichier de clé ou déchiffré suivi par git" ;;
  esac
  if [[ "$f" != "scripts/check-sops.sh" ]] \
    && grep -IEq 'AGE-SECRET-KEY-1[0-9A-Z]{58}' "$f" 2>/dev/null; then
    ko "$f : clé privée age en clair"
  fi

  case "$base" in
    .sops.yaml | .sops.yml) continue ;;
    *.sops.yaml | *.sops.yml | *.sops.json) ;;
    *.example.yaml | *.example.yml) continue ;;
    *.yaml | *.yml)
      # 5. Secret Kubernetes en clair
      if grep -qE '^kind:[ ]*Secret[ ]*$' "$f" && ! grep -q '{{' "$f"; then
        ko "$f : Secret Kubernetes en clair (utiliser un *.sops.yaml, cf. docs/SECRETS.md)"
      fi
      continue
      ;;
    *) continue ;;
  esac

  # 1. métadonnées SOPS
  if [[ "$base" == *.json ]]; then
    grep -q '"sops"' "$f" || { ko "$f : bloc \"sops\" absent (fichier non chiffré ?)"; continue; }
    continue
  fi
  grep -q '^sops:' "$f" || { ko "$f : bloc 'sops:' absent (fichier non chiffré ?)"; continue; }
  grep -qE '^[ ]+mac:[ ]+ENC\[' "$f" || ko "$f : sops.mac absent ou non chiffré"
  grep -qE '^[ ]+-?[ ]*recipient:[ ]+age1' "$f" || ko "$f : aucun recipient age"
  # 3. recipients placeholder
  grep -q 'age1CHANGEME' "$f" && ko "$f : recipient age CHANGEME"

  # 2. valeurs en clair
  case "$f" in
    gitops/*) mode=block ;;
    *) grep -qE '^kind:[ ]*Secret' "$f" && mode=block || mode=all ;;
  esac
  out=$(check_values "$f" "$mode")
  if [[ -n "$out" ]]; then printf '%s\n' "$out"; fail=1; fi
done

if ((fail)); then
  echo "check-sops : ECHEC" >&2
  exit 1
fi
echo "check-sops : OK (${#files[@]} fichiers examinés)"
