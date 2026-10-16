# Tests e2e locaux

Pile `docker compose` reproduisant la plateforme sans infrastructure : aucun accès au serveur, aucun secret réel.

| Service | Source | Rôle |
|---|---|---|
| `ctfd` | build de `apps/ctfd` (schéma de `challenges/schema` en contexte nommé) | CTFd + plugins `pad_*` |
| `mariadb` | image épinglée (identique à `gitops/apps/ctfd`) | base de CTFd |
| `valkey` | image épinglée (identique à `gitops/platform/valkey`) | cache et sessions |
| `chall-manager` | `mock-chall-manager/` (stdlib Python) | faux chall-manager, mêmes endpoints que `pad_common/chall_manager.py` |
| `front` | build de `apps/frontend/Dockerfile` (**profil `front`**), `PAD_MOCK=1` | front Next.js sans Authentik |

Authentik n'est pas déployé : le BFF (ou les scripts) obtient un token par `POST /api/v1/sso/session` signé en HMAC avec
le secret jetable de la pile. Tous les secrets du `docker-compose.yml` sont des valeurs propres au test.

## Utilisation

```sh
task e2e                      # build, démarrage, seed, smoke tests, puis arrêt
E2E_KEEP=1 task e2e           # idem mais laisse la pile active (CTFd sur http://127.0.0.1:8000)
task e2e -- up                # étapes séparées : up, seed, smoke, down, logs [service]
task e2e -- seed
task e2e -- smoke
task e2e -- down              # supprime conteneurs et volumes
```

Sans `task` : `tests/e2e/run.sh [all|up|seed|smoke|down|logs]`. Ports (`127.0.0.1` uniquement) : `E2E_CTFD_PORT` (8000),
`E2E_FRONT_PORT` (3000), `E2E_CM_PORT` (8080). `E2E_CM_LATENCY_MS` simule le temps de provisionnement d'une instance.

`seed` passe l'assistant `/setup` de CTFd, crée deux challenges (`e2e-static` à flag statique, `e2e-instance` de type
`dynamic_instance`) et écrit `.state/e2e.env` (ignoré par git) avec les variables consommées par `tests/load`.
`smoke` vérifie : santé de chaque service, émission d'un token joueur, liste des challenges, flag incorrect puis correct,
cycle d'une instance (création, prolongation, arrêt), scoreboard, métriques Prometheus.

## Front

Le service `front` utilise `apps/frontend/Dockerfile` (en cours de création). `run.sh` active automatiquement le profil `front`
dès que ce fichier existe ; sinon : `COMPOSE_PROFILES=front docker compose up --build`.
`PAD_MOCK=1` est refusé par le front avec `NODE_ENV=production` (`apps/frontend/src/lib/env.ts`) : le compose force
`NODE_ENV=development` à l'exécution. Si le Dockerfile fournit une cible `dev`, y préférer `build.target: dev`.
Playwright (`apps/frontend`, `pnpm e2e`) peut viser `http://127.0.0.1:3000` une fois la pile démarrée.

## Limites

- Le mock ne lance aucun conteneur : `connection_info` est factice, les flags d'instance sont ceux de `MOCK_FLAG`.
- Pas de TLS, pas de NetworkPolicy, pas d'Authentik : ces points se valident sur le serveur (`task verify`).
- `PAD_SSO_ALLOWED_CIDRS` est limité au réseau docker `172.31.250.0/24` (sous-réseau de test, sans lien avec `infra/contracts.yaml`).
