# Playwright (tests e2e du front)

**Couche** : Outillage et CI · **Où** : poste de dev et CI · **Version** : @playwright/test 1.64.1

## À quoi elle sert ici et pourquoi ce choix

Vérifie les parcours du front dans un vrai navigateur sans dépendre d'Authentik ni d'un vrai CTFd : le mode `PAD_MOCK=1` fournit un CTFd simulé en mémoire (`src/mocks/ctfd-fake.ts`) et une connexion de test.
Il génère aussi les captures d'écran de la documentation (`pnpm screenshots`).

## Où elle tourne et comment elle est déployée

`pnpm e2e` dans `apps/frontend` (serveur `next dev` en mode mock). En CI, job `frontend`. Chromium est fourni par l'environnement (`PW_CHROMIUM_PATH`) : ne pas lancer `playwright install` dans l'environnement cloud des agents.

## Version épinglée

`@playwright/test` 1.64.1 dans `apps/frontend/package.json` (verrou `pnpm-lock.yaml`).

## Fichiers de configuration dans le dépôt

`apps/frontend/playwright.config.ts`, `apps/frontend/e2e/`, `apps/frontend/src/mocks/`.

## Interactions avec les autres briques

Pilote le [front](frontend.md) ; complète vitest + msw (tests unitaires) et la pile `docker compose` de `tests/e2e` (smoke tests contre un vrai CTFd).

## Sécurité

Le mode mock est refusé en production (`NODE_ENV=production`) ; aucun secret réel n'est utilisé.

## Supervision

Résultats dans la CI ([GitHub Actions](github-actions.md)).

## Opérations courantes

```bash
cd apps/frontend
pnpm e2e
PW_CHROMIUM_PATH=/chemin/vers/chrome pnpm e2e    # réutiliser un Chromium existant
pnpm screenshots
```

## Pièges connus

`AUTH_SECRET` et `PAD_SSO_SHARED_SECRET` (32 caractères minimum) sont requis, même en mode mock (voir `.env.example`).

## Documentation officielle

[playwright.dev](https://playwright.dev/docs/intro)

[Retour à l'index des composants](index.md){ .md-button }
