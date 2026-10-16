# ADR 11 : Bases de données : MariaDB et Valkey

**Statut** : acceptée.

## Contexte

CTFd supporte officiellement MariaDB. Le front a besoin d'un cache partagé entre replicas (tokens CTFd, verrous, copie de l'événement).

## Décision

**mariadb-operator** gère le MariaDB de CTFd (sauvegardes planifiées vers Garage incluses). **Valkey** sert de cache partagé et de support du rate limiting. Les mots de passe sont générés une seule fois par `task secrets:init` et recopiés là où il faut.

## Alternatives écartées

- **PostgreSQL pour CTFd** : non supporté officiellement par CTFd.
- **Redis** : licence ; Valkey en est le fork communautaire compatible.
- **Base managée externe** : contraire à l'objectif d'une plateforme autonome et reconstructible.

## Conséquences

- `task backup` et `task restore` couvrent MariaDB et Garage ; voir [sauvegarde et restauration](../runbooks/backup-restore.md).
- Authentik a sa propre PostgreSQL, sauvegardée par un timer systemd dans son LXC.
