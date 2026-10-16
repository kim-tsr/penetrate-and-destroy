#!/usr/bin/env bash
# Build reproductible d'une image PAD : build-image.sh <name> <context> <dockerfile>
# Ordre : build -> scan Trivy bloquant (SCAN=1) -> push (PUSH=1) -> signature cosign (SIGN=1).
# Env : SCAN=1 (scan Trivy HIGH/CRITICAL corrigeables AVANT tout push), PUSH=1 (push),
#       SIGN=1 (cosign du digest, COSIGN_KEY sinon keyless OIDC),
#       PLATFORMS (défaut linux/amd64), VERSION (tag additionnel),
#       REGISTRY (défaut ghcr.io/kim-tsr), BUILD_CONTEXTS (contextes nommés, séparés par espaces : nom=chemin)
# Sortie : stdout ne contient QUE la référence finale image@digest (les journaux vont sur stderr).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <name> <context> <dockerfile>" >&2
  exit 2
fi
name=$1 context=$2 dockerfile=$3

registry=${REGISTRY:-ghcr.io/kim-tsr}
platforms=${PLATFORMS:-linux/amd64}
image="${registry}/pad-${name}"
sha=$(git rev-parse --short HEAD)
sde=$(git log -1 --format=%ct -- "$context")
sde=${sde:-$(git log -1 --format=%ct)}

tags=(-t "${image}:${sha}")
if [ -n "${VERSION:-}" ]; then tags+=(-t "${image}:${VERSION}"); fi

extra=()
for bc in ${BUILD_CONTEXTS:-}; do extra+=(--build-context "$bc"); done

output="type=image,rewrite-timestamp=true"
if [ "${PUSH:-0}" = 1 ]; then output+=",push=true"; fi

work=$(mktemp -d)
meta="${work}/metadata.json"
trap 'rm -rf "$work"' EXIT

# Étape 1 (SCAN=1) : build local en archive OCI (sans attestations), puis scan Trivy BLOQUANT. Rien n'est poussé ni
# signé si le scan échoue. Exige un builder buildx à pilote docker-container (docker/setup-buildx-action). Le cache de
# couches est réutilisé à l'étape 2 : l'image poussée a les mêmes couches que l'image scannée (horodatages réécrits
# avec SOURCE_DATE_EPOCH). Seule la première plateforme de PLATFORMS est scannée.
cache=()
if [ "${SCAN:-0}" = 1 ]; then
  scan_platform=${platforms%%,*}
  docker buildx build \
    --file "$dockerfile" \
    --platform "$scan_platform" \
    --build-arg "SOURCE_DATE_EPOCH=${sde}" \
    --provenance=false \
    --sbom=false \
    --output "type=oci,dest=${work}/image.tar,rewrite-timestamp=true" \
    --cache-to "type=local,dest=${work}/cache,mode=max" \
    "${tags[@]}" \
    ${extra[@]+"${extra[@]}"} \
    "$context" >&2
  echo "Scan Trivy de ${image} (${scan_platform})" >&2
  trivy image --input "${work}/image.tar" --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed >&2
  cache=(--cache-from "type=local,src=${work}/cache")
fi

# Étape 2 : build final (provenance et SBOM), push éventuel.
docker buildx build \
  --file "$dockerfile" \
  --platform "$platforms" \
  --build-arg "SOURCE_DATE_EPOCH=${sde}" \
  --provenance=mode=max \
  --sbom=true \
  --output "$output" \
  --metadata-file "$meta" \
  "${tags[@]}" \
  ${cache[@]+"${cache[@]}"} \
  ${extra[@]+"${extra[@]}"} \
  "$context" >&2

digest=$(sed -n 's/.*"containerimage.digest": *"\(sha256:[0-9a-f]*\)".*/\1/p' "$meta" | head -n1)
if [ -z "$digest" ]; then
  echo "digest introuvable dans les métadonnées de build" >&2
  exit 1
fi

if [ "${SIGN:-0}" = 1 ]; then
  if [ "${PUSH:-0}" != 1 ]; then
    echo "SIGN=1 exige PUSH=1" >&2
    exit 1
  fi
  if [ -n "${COSIGN_KEY:-}" ]; then
    cosign sign --yes --key "$COSIGN_KEY" "${image}@${digest}" >&2
  else
    cosign sign --yes "${image}@${digest}" >&2
  fi
fi

echo "${image}@${digest}"
