#!/usr/bin/env bash
# Build reproductible d'une image PAD : build-image.sh <name> <context> <dockerfile>
# Env : PUSH=1 (push), SIGN=1 (cosign du digest, COSIGN_KEY sinon keyless OIDC),
#       PLATFORMS (défaut linux/amd64), VERSION (tag additionnel),
#       REGISTRY (défaut ghcr.io/kim-tsr), BUILD_CONTEXTS (contextes nommés, séparés par espaces : nom=chemin)
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
[ -n "${VERSION:-}" ] && tags+=(-t "${image}:${VERSION}")

extra=()
for bc in ${BUILD_CONTEXTS:-}; do extra+=(--build-context "$bc"); done

output="type=image,rewrite-timestamp=true"
[ "${PUSH:-0}" = 1 ] && output+=",push=true"

meta=$(mktemp)
trap 'rm -f "$meta"' EXIT

docker buildx build \
  --file "$dockerfile" \
  --platform "$platforms" \
  --build-arg "SOURCE_DATE_EPOCH=${sde}" \
  --provenance=mode=max \
  --sbom=true \
  --output "$output" \
  --metadata-file "$meta" \
  "${tags[@]}" \
  ${extra[@]+"${extra[@]}"} \
  "$context"

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
    cosign sign --yes --key "$COSIGN_KEY" "${image}@${digest}"
  else
    cosign sign --yes "${image}@${digest}"
  fi
fi

echo "${image}@${digest}"
