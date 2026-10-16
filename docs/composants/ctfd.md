# CTFd (headless)

**Couche** : Applications CTF · **Où** : pods du cluster (namespace `ctfd`, 2 à 4 replicas) · **Version** : 3.8.8 (image `ctfd/ctfd` épinglée par digest) + plugins pad_*

## À quoi elle sert ici et pourquoi ce choix

CTFd gère le cœur du jeu (challenges, flags, scores, équipes), mais il est utilisé **en headless** : le navigateur ne lui parle jamais, c'est le [front](frontend.md) qui consomme son API.
Les plugins `pad_*` ajoutent ce qui manque (SSO par pont HMAC, instances, équipes sûres, import, métriques). Le login local est désactivé (404), sauf un accès de secours pour les admins.

## Où elle tourne et comment elle est déployée

Image `pad-ctfd` construite par la CI (`apps/ctfd/Dockerfile`) à partir de l'image officielle épinglée, avec dépendances à hashes obligatoires. Déploiement `gitops/apps/ctfd` :
Deployment (2 à 4 replicas selon [KEDA](keda.md)), Ingress sur `ctfd-admin` (interne), ServiceMonitor, NetworkPolicy, base [MariaDB](mariadb.md), cache [Valkey](valkey.md), uploads sur [Garage](garage.md).

## Version épinglée

- Image de base : `docker.io/ctfd/ctfd:3.8.8@sha256:...` dans `apps/ctfd/Dockerfile`.
- Dépendances Python des plugins : `apps/ctfd/requirements.txt` (versions et hashes exacts, `--require-hashes`).
- Image déployée : `gitops/apps/ctfd/deployment.yaml` (tag `0.1.0`, maintenu avec la CI).

## Fichiers de configuration dans le dépôt

- `apps/ctfd/Dockerfile`, `requirements.txt`, `README.md`, `API.md`, `scripts/test.sh`, `tests/`.
- `gitops/apps/ctfd/` : `deployment.yaml`, `mariadb.yaml`, `ingress.yaml`, `networkpolicy.yaml`, `scaledobject.yaml`, `servicemonitor.yaml`, `secret.example.yaml`.
- Variables : `UPLOAD_PROVIDER=s3`, `REDIS_HOST`, `DATABASE_*`, `PAD_*` (voir [les plugins](index.md#applications-ctf)).

## Interactions avec les autres briques

Appelé par le [front](frontend.md) (API) ; parle à [chall-manager](chall-manager.md) (plugin `chall_manager_bridge`) ; stocke dans [MariaDB](mariadb.md), [Valkey](valkey.md), [Garage](garage.md) ;
expose des métriques à [VictoriaMetrics](victoriametrics.md) ; fournit les membres d'équipe à [netbird-sync](netbird-sync.md).

## Sécurité

- Login, inscription, réinitialisation et OAuth natifs répondent 404 ; seul `sso_bridge` crée des sessions. Accès de secours optionnel `PAD_LOCAL_LOGIN_BREAKGLASS` limité à des hôtes (`PAD_LOCAL_LOGIN_HOSTS`).
- Création de token acceptée seulement depuis le CIDR des pods (`PAD_SSO_ALLOWED_CIDRS`) et avec HMAC valide.
- Utilisateur non-root (UID 1001), NetworkPolicy de namespace, `WORKERS=2`, `REVERSE_PROXY` configuré.

## Supervision

- Exporter `metrics_exporter` (voir [sa page](ctfd-plugin-metrics-exporter.md)) ; alertes `CtfdDeploymentDown`, `CtfdMetricsMissing`, `CtfdIncorrectSubmissionsBurst`, `CtfEventPaused` : [CTFd](../runbooks/ctfd.md).
- Dashboard `pad-live-ctf`.

## Opérations courantes

```bash
task apps:build:ctfd
bash apps/ctfd/scripts/test.sh
kubectl -n ctfd get pods,scaledobject
```

## Pièges connus

- CTFd 3.8 ne connecte un porteur de `Authorization: Token` que si la requête est en JSON (`Content-Type: application/json`), même pour un GET.
- Un cookie de session prime sur le header `Authorization` : le front ne relaie jamais de cookie CTFd.
- Le build exige le contexte nommé `schema=../../challenges/schema` (pas de schéma de secours).

## Documentation officielle

[docs.ctfd.io](https://docs.ctfd.io/)

[Retour à l'index des composants](index.md){ .md-button }
