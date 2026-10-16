#!/usr/bin/env bash
# Lance les tests pytest des plugins pad_* dans le harnais de test officiel de CTFd.
#
# 1. clone CTFd à la version de l'image (CTFD_VERSION) dans un cache local ;
# 2. crée un venv Python 3.11 (version de l'image officielle) avec development.txt ;
# 3. lie nos plugins dans CTFd/plugins et nos tests dans tests/pad/ ;
# 4. exécute pytest (SQLite en mémoire, cache "simple").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
CTFD_VERSION="${CTFD_VERSION:-$(sed -n 's/^ARG CTFD_VERSION=//p' "${HERE}/Dockerfile")}"
CACHE="${PAD_TEST_CACHE:-${REPO_ROOT}/.state/ctfd-harness}"
PYTHON="${PYTHON:-python3.11}"
SRC="${CACHE}/ctfd-${CTFD_VERSION}"
VENV="${CACHE}/venv-${CTFD_VERSION}"

mkdir -p "${CACHE}"
if [ ! -d "${SRC}" ]; then
  git clone --quiet --depth 1 --branch "${CTFD_VERSION}" https://github.com/CTFd/CTFd.git "${SRC}"
fi
if [ ! -x "${VENV}/bin/pytest" ]; then
  "${PYTHON}" -m venv "${VENV}"
  "${VENV}/bin/pip" install --quiet -r "${SRC}/development.txt"
  "${VENV}/bin/pip" install --quiet --require-hashes -r "${HERE}/requirements.txt"
fi

for plugin in "${HERE}"/plugins/*/; do
  name="$(basename "${plugin}")"
  [ -f "${plugin}__init__.py" ] || continue
  ln -sfn "${plugin%/}" "${SRC}/CTFd/plugins/${name}"
done
rm -rf "${SRC}/tests/pad"
cp -R "${HERE}/tests" "${SRC}/tests/pad"

export PAD_CHALLENGE_SCHEMA="${REPO_ROOT}/challenges/schema/challenge.schema.json"
cd "${SRC}"
exec "${VENV}/bin/python" -m pytest -p no:randomly -p no:sugar -q tests/pad "$@"
