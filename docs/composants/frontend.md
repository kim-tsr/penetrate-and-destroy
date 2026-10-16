# Front Next.js (Auth.js et BFF)

**Couche** : Applications CTF · **Où** : pods du cluster (namespace `frontend`, 2 à 4 replicas) · **Version** : Next.js 16.4.2, React 19.3.1, next-auth 5.0.0-beta.32

## À quoi elle sert ici et pourquoi ce choix

Seule application que touche le navigateur : espace joueur (challenges, équipe, instances, scoreboard en direct, notifications, onboarding NetBird) et portail manager. Le **BFF** (routes `src/app/api/**`)
valide les entrées, limite les débits, contrôle l'origine et n'expose **aucun token CTFd** au navigateur. Il n'appelle jamais chall-manager directement.

## Où elle tourne et comment elle est déployée

Image `pad-frontend` (Dockerfile multi-stage, sortie `standalone`, UID 10001, rootfs en lecture seule). `gitops/apps/frontend` : Deployment, Ingress, ScaledObject KEDA (2 à 4 replicas, CPU 70 % et sessions actives), ServiceMonitor, NetworkPolicy.

## Version épinglée

`apps/frontend/package.json` (versions exactes, `pnpm-lock.yaml`, `packageManager: pnpm@10.30.3`, Node >= 22.12) ; base `node:22-alpine@sha256:...` dans `apps/frontend/Dockerfile` ; image `pad-frontend:0.1.0` dans `gitops/apps/frontend/deployment.yaml`.

## Fichiers de configuration dans le dépôt

- `apps/frontend/src/` : `auth.ts` (Auth.js, provider Authentik, PKCE), `proxy.ts` (rôles, CSP à nonce), `lib/ctfd/*` (client CTFd), `lib/ctfd-token.ts` (token partagé via Valkey), `app/api/**` (BFF).
- `gitops/apps/frontend/` ; `apps/frontend/README.md`, `.env.example`, `playwright.config.ts`, `vitest.config.ts`.

## Interactions avec les autres briques

- Authentifie via [Authentik](authentik.md) (client `pad-frontend`, scopes incluant `groups`).
- Appelle [CTFd](ctfd.md) avec un token obtenu par [sso_bridge](ctfd-plugin-sso-bridge.md) ; cache le token et l'état de l'événement dans [Valkey](valkey.md).
- Lit l'état NetBird d'un joueur (lecture seule) pour guider l'onboarding ; envoie traces et métriques à la [pile de supervision](victoriametrics.md).

## Sécurité

- Pas de token CTFd côté navigateur ; CSP stricte à nonce ; validation `zod` ; contrôle d'origine (CSRF) ; limitation de débit.
- Fichiers de challenge servis par `/api/files/...` : l'URL signée de CTFd n'est jamais renvoyée au navigateur.
- Mode simulé (`PAD_MOCK=1`) refusé avec `NODE_ENV=production` : le serveur s'arrête au démarrage.
- `/api/metrics` exige un jeton en production ; `/api/health` est publique et sans dépendance bloquante.

## Supervision

Métriques `pad_frontend_*` (dont `pad_frontend_active_sessions`) ; alertes `FrontendHigh5xxRatio`, `FrontendCtfdSlow`, `FrontendMetricsMissing` : [Front](../runbooks/frontend.md).

## Opérations courantes

```bash
cd apps/frontend
pnpm install --frozen-lockfile
pnpm dev:mock                 # CTFd simulé, connexion de test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e                      # Playwright en mode mock
task apps:build:frontend
```

## Pièges connus

- Le token CTFd vit 15 min alors que la session Auth.js en dure 12 h : réémission transparente (un verrou Valkey évite N appels simultanés ; fail-open si Valkey est indisponible).
- Un cookie CTFd présent prime sur `Authorization` : ne jamais en relayer.
- Pour monter en version de Next.js, relancer lint, typecheck, tests, build et Playwright.

## Documentation officielle

[nextjs.org/docs](https://nextjs.org/docs) · [authjs.dev](https://authjs.dev/)

[Retour à l'index des composants](index.md){ .md-button }
