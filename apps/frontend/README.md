# Front PenetrateAndDestroy

Front Next.js 16 (App Router) de la plateforme : espace joueur, portail manager et BFF devant CTFd (headless).
Direction artistique « salle d'opérations » (graphite, crème, ambre ; Big Shoulders Display + JetBrains Mono auto-hébergées).

## Architecture

| Couche | Rôle |
|---|---|
| `src/proxy.ts` | Redirections, contrôle de rôle `/manage`, CSP stricte à nonce (`src/lib/csp.ts`) |
| `src/auth.ts` | Auth.js v5 : OIDC Authentik (groupes `ctf-players`, `ctf-managers`, `ctf-admins`) ; connexion de test uniquement avec `PAD_MOCK=1` |
| `src/lib/ctfd/*` | Client CTFd unique (`adapter.ts` = seul fichier qui connaît le format de `apps/ctfd/API.md`) |
| `src/lib/ctfd-token.ts` | Les tokens `sso_bridge` vivent 15 min : réémission transparente, partagée entre replicas via Valkey |
| `src/app/api/**` | BFF : validation zod, rate limiting, contrôle d'origine (CSRF), aucun token CTFd côté navigateur |
| `src/mocks/ctfd-fake.ts` | CTFd simulé en mémoire (mode `PAD_MOCK=1`, tests msw) |

Le front n'appelle pas chall-manager directement : les instances passent par le plugin CTFd `chall_manager_bridge`.

## Commandes

```sh
pnpm install --frozen-lockfile
pnpm dev:mock        # PAD_MOCK=1 : CTFd simulé + connexion de test (AUTH_SECRET et PAD_SSO_SHARED_SECRET requis, cf. .env.example)
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm e2e             # Playwright en mode mock (next dev) ; PW_CHROMIUM_PATH pour réutiliser un Chromium existant
```

## Sécurité

- `PAD_MOCK=1` est refusé avec `NODE_ENV=production` : le serveur s'arrête au démarrage (`src/instrumentation-node.ts`).
- `/api/metrics` exige `METRICS_TOKEN` en production ; `/api/health` est publique et sans dépendance bloquante.
- Aucune valeur réelle dans le dépôt : `.env.example` et `gitops/apps/frontend/secret.example.yaml` ne contiennent que des `CHANGEME`.

## Image et déploiement

`Dockerfile` multi-stage (sortie `standalone`, utilisateur 10001, rootfs en lecture seule), build via `task apps:build:frontend`.
Manifestes : `gitops/apps/frontend` (un seul `ScaledObject` KEDA : CPU + `pad_frontend_active_sessions`).
