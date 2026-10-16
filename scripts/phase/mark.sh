#!/usr/bin/env bash
# Marqueurs de phase (.state/phases/<phase>.ok), lus par `task status`.
#   scripts/phase/mark.sh set <phase>      écrit le marqueur (date)
#   scripts/phase/mark.sh clear <phase>... efface ces marqueurs ; `clear all` les efface tous
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dir="${ROOT_DIR}/.state/phases"
case "${1:-}" in
  set)
    mkdir -p "$dir"
    date '+%Y-%m-%d %H:%M' >"${dir}/${2:?phase}.ok"
    ;;
  clear)
    shift
    if [[ "${1:-}" == all ]]; then rm -rf "$dir"; else for p in "$@"; do rm -f "${dir}/${p}.ok"; done; fi
    ;;
  *)
    echo "usage : $0 set <phase> | clear <phase>... | clear all" >&2
    exit 2
    ;;
esac
