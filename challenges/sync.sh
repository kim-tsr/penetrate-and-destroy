#!/usr/bin/env bash
# Zippe un dossier de challenge et l'importe dans CTFd (POST /api/v1/manager/challenges/import).
# Usage : PAD_CTFD_URL=https://ctfd.CHANGEME.example.net PAD_CTFD_TOKEN=... ./sync.sh <dossier-challenge>
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1/challenge.yml" ]]; then
  echo "usage: $0 <dossier-contenant-challenge.yml>" >&2
  exit 2
fi
: "${PAD_CTFD_URL:?PAD_CTFD_URL requis}"
: "${PAD_CTFD_TOKEN:?PAD_CTFD_TOKEN requis}"

dir=$(cd "$1" && pwd)
name=$(basename "$dir")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Zip avec ordre de fichiers stable, sans attributs étendus (-X).
(cd "$dir" && find . -type f ! -name '*.zip' | LC_ALL=C sort | sed 's|^\./||' | zip -X -q "$tmp/$name.zip" -@)

body="$tmp/response.json"
code=$(curl --silent --show-error --fail-with-body --output "$body" --write-out '%{http_code}' \
  --request POST \
  --header "Authorization: Token ${PAD_CTFD_TOKEN}" \
  --form "file=@${tmp}/${name}.zip;type=application/zip" \
  "${PAD_CTFD_URL%/}/api/v1/manager/challenges/import") || { cat "$body" >&2; exit 1; }

echo "import ${name}: HTTP ${code}"
cat "$body"
echo
