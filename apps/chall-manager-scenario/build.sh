#!/usr/bin/env bash
# Compile le scénario (binaire statique linux/amd64) et le pousse en OCI pour chall-manager.
# Usage : ./build.sh <tag> [--push]
#   REF par défaut : contracts apps.chall_manager.generic_scenario
# Dépend de : go, oras (nix shell nixpkgs#oras). Authentification : `oras login <registre>`.
set -euo pipefail

TAG="${1:?usage: build.sh <tag> [--push]}"
REF="${REF:-registry.CHANGEME.example.net/pad/scenarios/k8s-instance}" # contracts: apps.chall_manager.generic_scenario
cd "$(dirname "$0")"

rm -rf dist && mkdir dist
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/main .
cp Pulumi.yaml dist/Pulumi.yaml

if [[ "${2:-}" == "--push" ]]; then
  (cd dist && oras push "${REF}:${TAG}" \
    --artifact-type application/vnd.ctfer-io.scenario \
    --media-type application/vnd.ctfer-io.file \
    Pulumi.yaml main)
else
  echo "Artefact prêt dans dist/ (ajouter --push pour publier ${REF}:${TAG})"
fi
