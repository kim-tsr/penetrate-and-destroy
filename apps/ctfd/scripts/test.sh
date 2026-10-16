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
# Venv isolé : le PYTHONPATH du devshell nix (paquets python3.12) ne doit pas fuir dans le venv 3.11
# (sinon cffi/_cffi_backend introuvable et conflits pip avec checkov, openai, pydantic).
unset PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE
# Les roues manylinux du venv (greenlet via gevent) attendent libstdc++.so.6 : le devshell nix l'expose via
# PAD_LIBSTDCXX_DIR (flake.nix). Ajouté à LD_LIBRARY_PATH uniquement dans ce script, donc pour le venv du harnais seul.
if [ -n "${PAD_LIBSTDCXX_DIR:-}" ]; then
  if [ -f "${PAD_LIBSTDCXX_DIR}/libstdc++.so.6" ]; then
    export LD_LIBRARY_PATH="${PAD_LIBSTDCXX_DIR}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  else
    echo "avertissement : PAD_LIBSTDCXX_DIR=${PAD_LIBSTDCXX_DIR} ne contient pas libstdc++.so.6" >&2
  fi
fi
export PIP_USER=0 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONNOUSERSITE=1
if ! command -v "${PYTHON}" >/dev/null 2>&1; then
  echo "interpréteur introuvable : ${PYTHON} (CTFd 3.8 tourne sur Python 3.11 ; 'nix develop' le fournit, sinon PYTHON=/chemin/python3.11)" >&2
  exit 2
fi
SRC="${CACHE}/ctfd-${CTFD_VERSION}"
VENV="${CACHE}/venv-${CTFD_VERSION}"

mkdir -p "${CACHE}"
if [ ! -d "${SRC}" ]; then
  git clone --quiet --depth 1 --branch "${CTFD_VERSION}" https://github.com/CTFd/CTFd.git "${SRC}"
fi
if [ ! -x "${VENV}/bin/pytest" ]; then
  rm -rf "${VENV}"
  "${PYTHON}" -I -m venv "${VENV}"
  "${VENV}/bin/pip" install --quiet -r "${SRC}/development.txt"
  # Échec bavard et précoce si greenlet (gevent) ne charge pas, plutôt qu'à l'import de CTFd.
  "${VENV}/bin/python" -I -c 'import greenlet._greenlet' || {
    echo "ÉCHEC : greenlet ne charge pas (libstdc++.so.6 ? PAD_LIBSTDCXX_DIR=${PAD_LIBSTDCXX_DIR:-non défini}, LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-vide})" >&2
    exit 1
  }
  "${VENV}/bin/pip" install --quiet --no-deps --require-hashes -r "${HERE}/requirements.txt"
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
