# syntax=docker/dockerfile:1.28@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
#
# Image du front PenetrateAndDestroy (Next.js, sortie `standalone`).
#
# Build reproductible (voir apps/Taskfile.yml et scripts/build-image.sh) :
#   docker buildx build \
#     --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct -- apps/frontend) \
#     --output type=image,rewrite-timestamp=true apps/frontend
#
# - base épinglée par digest (22-alpine = Node >= 22.12, exigence de Next 16) ; Renovate maintient le digest ;
# - dépendances installées avec `--frozen-lockfile` (pnpm-lock.yaml fait foi), pnpm épinglé via `packageManager` ;
# - identifiant de build Next dérivé de SOURCE_DATE_EPOCH (pas d'horodatage ni de hash aléatoire dans le bundle) ;
# - image finale : utilisateur non-root (10001), fichiers en lecture seule, compatible `readOnlyRootFilesystem`
#   (monter des emptyDir sur /tmp et /app/.next/cache).

ARG NODE_IMAGE=docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
# corepack lit `packageManager` (pnpm@10.30.3) dans package.json : version exacte, pas de `latest`.
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pad-frontend-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM base AS build
ARG SOURCE_DATE_EPOCH
ENV NODE_ENV=production \
    PAD_BUILD_ID=${SOURCE_DATE_EPOCH}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Aucun secret au build : toute la configuration est lue à l'exécution (src/lib/env.ts).
RUN pnpm build

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_DATE_EPOCH
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# npm, npx, corepack et yarn ne servent pas à l'exécution (node server.js) : on les retire, car les dépendances
# embarquées par npm portent des CVE HIGH corrigeables uniquement par une nouvelle version de l'image de base.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
      /opt/yarn-*

# Fichiers appartenant à root (lecture seule pour l'utilisateur d'exécution), sauf le cache Next.
COPY --from=build --chown=0:0 --chmod=0755 /app/.next/standalone ./
COPY --from=build --chown=0:0 --chmod=0755 /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown 10001:10001 .next/cache

LABEL org.opencontainers.image.title="pad-frontend" \
      org.opencontainers.image.description="Front Next.js PenetrateAndDestroy (espace joueur, portail manager, BFF)" \
      org.opencontainers.image.source="https://github.com/kim-tsr/penetrate-and-destroy" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.base.name="docker.io/library/node:22-alpine"

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
