#!/usr/bin/env bash
# Met à jour les références `tag@sha256` des images PAD publiées par images.yml.
#
# USAGE   scripts/pin-image-digests.sh <owner> <tag>
#   <owner> propriétaire ghcr (minuscules), ex. la valeur de `github.repository_owner`
#   <tag>   tag publié par images.yml pour le commit courant (sha court, cf. scripts/build-image.sh)
#
# Pour chaque image `ghcr.io/<owner>/pad-<nom>:<tag>` existante, lit son empreinte (index OCI) dans le registre et réécrit :
#   - gitops/apps/*/deployment.yaml : `ghcr.io/<x>/pad-<nom>:<ancien tag>@sha256:<ancienne empreinte>` -> `<tag>@sha256:<empreinte>`
#     (noms : ctfd, frontend, netbird-sync) ;
#   - challenges/*/challenge.yml : `registry.pad.internal/ctf/<nom>:<version>@sha256:<ancienne>` -> même version, nouvelle
#     empreinte (image `pad-chal-<nom>` ; l'empreinte est identique dans Zot si l'image y est copiée à l'identique, p. ex.
#     `crane copy`, qui conserve l'index et donc l'empreinte).
# Une image absente du registre est ignorée avec un avertissement (aucune référence n'est alors modifiée).
# Imprime sur stdout les fichiers modifiés. Outils : crane OU docker buildx (imagetools), sed.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <owner> <tag>" >&2
  exit 2
fi
owner=$1 tag=$2
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

# digest_of <référence> : imprime sha256:<64 hex> ou rien si introuvable.
digest_of() {
  local d=""
  if command -v crane >/dev/null 2>&1; then
    d=$(crane digest "$1" 2>/dev/null || true)
  else
    d=$(docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}' 2>/dev/null || true)
  fi
  if printf '%s' "$d" | grep -Eq '^sha256:[0-9a-f]{64}$'; then printf '%s' "$d"; fi
}

changed=()
# repin <fichier> <expression sed -E avec \1 = préfixe conservé> : remplace si le contenu change.
repin() {
  local file=$1 expr=$2 before
  before=$(sha256sum "$file")
  sed -E -i "$expr" "$file"
  if [ "$before" != "$(sha256sum "$file")" ]; then changed+=("$file"); fi
}

for name in ctfd frontend netbird-sync; do
  digest=$(digest_of "ghcr.io/${owner}/pad-${name}:${tag}")
  if [ -z "$digest" ]; then
    echo "AVERTISSEMENT : ghcr.io/${owner}/pad-${name}:${tag} introuvable, référence inchangée" >&2
    continue
  fi
  for f in gitops/apps/*/deployment.yaml; do
    grep -Eq "ghcr\.io/[^/]+/pad-${name}:" "$f" || continue
    repin "$f" "s#(ghcr\.io/[^/]+/pad-${name}):[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}#\1:${tag}@${digest}#"
  done
done

for dir in challenges/*/; do
  name=$(basename "$dir")
  f="${dir}challenge.yml"
  [ -f "$f" ] || continue
  grep -Eq "registry\.pad\.internal/ctf/${name}:" "$f" || continue
  digest=$(digest_of "ghcr.io/${owner}/pad-chal-${name}:${tag}")
  if [ -z "$digest" ]; then
    echo "AVERTISSEMENT : ghcr.io/${owner}/pad-chal-${name}:${tag} introuvable, ${f} inchangé" >&2
    continue
  fi
  repin "$f" "s#(registry\.pad\.internal/ctf/${name}:[A-Za-z0-9._-]+)@sha256:[0-9a-f]{64}#\1@${digest}#"
done

if [ "${#changed[@]}" -gt 0 ]; then printf '%s\n' "${changed[@]}" | sort -u; fi
