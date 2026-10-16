# syntax=docker/dockerfile:1.28@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
#
# Image CTFd PenetrateAndDestroy : image officielle épinglée + plugins pad_*.
#
# Build (voir apps/Taskfile.yml, tâche build) :
#   docker buildx build \
#     --build-context schema=../../challenges/schema \
#     --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
#     --output type=image,rewrite-timestamp=true ...
#
# Le contexte de build reste apps/ctfd (pas besoin de la racine du repo) ; le
# schéma, hors de ce contexte, est fourni par le contexte nommé `schema`.
# Le contexte nommé `schema` apporte challenges/schema/challenge.schema.json,
# source unique du format ctfcli étendu (validé par le plugin manager_api).

# Version vérifiée le 2026-10-16 : 3.8.8 (release GitHub du 2026-10-02), dernière publiée.
ARG CTFD_VERSION=3.8.8
FROM docker.io/ctfd/ctfd:3.8.8@sha256:07cc9788d58b2a18ea4dc2103ff385c053ffc506f57d0c769a99387849aedd01

ARG SOURCE_DATE_EPOCH
ARG CTFD_VERSION

# Correctifs de sécurité de la base Debian (perl-base, libpcre2) et du Python système, appliqués en root.
USER 0
COPY requirements-system.txt /tmp/pad-requirements-system.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade perl-base libpcre2-8-0 \
    && rm -rf /var/lib/apt/lists/* \
    && /usr/local/bin/python -m pip install --no-cache-dir --no-compile --no-deps --require-hashes \
         -r /tmp/pad-requirements-system.txt \
    && rm -f /tmp/pad-requirements-system.txt

# L'image officielle tourne en UID 1001 avec /opt/venv lui appartenant.
USER 1001

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Dépendances des plugins : versions exactes + hashes obligatoires.
COPY --chown=1001:1001 requirements.txt /tmp/pad-requirements.txt
RUN pip install --no-compile --no-deps --require-hashes -r /tmp/pad-requirements.txt \
    && rm -f /tmp/pad-requirements.txt

# Plugins en lecture seule pour l'utilisateur d'exécution (propriétaire root).
COPY --chown=0:0 --chmod=0755 plugins/ /opt/CTFd/CTFd/plugins/
COPY --chown=0:0 --chmod=0644 --from=schema challenge.schema.json \
     /opt/CTFd/CTFd/plugins/manager_api/challenge.schema.json

LABEL org.opencontainers.image.title="pad-ctfd" \
      org.opencontainers.image.description="CTFd headless + plugins PenetrateAndDestroy" \
      org.opencontainers.image.source="https://github.com/kim-tsr/penetrate-and-destroy" \
      org.opencontainers.image.base.name="docker.io/ctfd/ctfd:3.8.8" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.pad.ctfd.version="${CTFD_VERSION}"

USER 1001
EXPOSE 8000
ENTRYPOINT ["/opt/CTFd/docker-entrypoint.sh"]
