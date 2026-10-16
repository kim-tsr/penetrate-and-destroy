# Docker et Compose (dans les LXC)

**Couche** : Services LXC · **Où** : chaque LXC de services (edge, netbird, warpgate, authentik, monitoring) · **Version** : docker-ce 5:29.9.1, containerd 2.4.2, compose 5.6.0

## À quoi elle sert ici et pourquoi ce choix

Les services d'infrastructure (edge, VPN, bastion, IdP, supervision) tournent **hors du cluster**, de sorte que celui-ci puisse
être détruit et reconstruit sans perdre l'accès, l'identité ni la supervision. Chaque service est un Docker Compose rendu par Ansible
dans un LXC Debian 13 non privilégié.

## Où elle tourne et comment elle est déployée

Rôle Ansible `docker` (dépôt apt officiel, paquets versionnés puis mis en `hold`). Les LXC sont créés avec `nesting` et `keyctl`
par le module tofu `lxc-service`. Pas de `userns-remap` : incompatible avec un LXC non privilégié déjà dans un user namespace.

## Version épinglée

`pad_apt_versions` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml` : `docker_ce` 5:29.9.1-1~debian.13~trixie,
`containerd` 2.4.2-2, `docker_compose_plugin` 5.6.0-1.

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/docker/` : `defaults/main.yml`, `templates/daemon.json.j2`.
- `infra/tofu/modules/lxc-service/main.tf` : `unprivileged`, `features { nesting, keyctl }`.
- Répertoire des Compose : `pad_compose_root` (`/opt/pad/<service>`).

## Interactions avec les autres briques

Héberge [Traefik edge](traefik-edge.md), [CrowdSec](crowdsec.md), [NetBird](netbird.md), [Warpgate](warpgate.md), [Authentik](authentik.md) et la
[pile de monitoring](victoriametrics.md). [Alloy](alloy.md) découvre les conteneurs par le socket Docker.

## Sécurité

- Journaux `json-file` bornés (10 Mo x 3, compressés), `live-restore` activé.
- `no-new-privileges` sur tous les services ; `read_only` et `cap_drop: ALL` pour Traefik et Warpgate.
- Le pare-feu Proxmox des LXC est désactivé : le filtrage est fait par [OPNsense](opnsense.md).

## Supervision

Métriques du démon Docker sur le port 9323 (job `docker`) et cAdvisor via Alloy. Alertes `DockerDaemonDown`,
`DockerHealthchecksFailing` : [Docker dans un LXC](../runbooks/docker-lxc.md).

## Opérations courantes

```bash
task ansible:services -- --tags docker
# sur un LXC
docker compose -f /opt/pad/<service>/compose.yml ps
docker compose -f /opt/pad/<service>/compose.yml logs -f
```

## Pièges connus

- Les paquets Docker sont en `hold` : les mettre à jour via `versions.yml`.
- Docker dans un LXC exige `nesting` et `keyctl` ; ajuster les quotas `kernel.keys.*` de l'hôte (fait par `host-tuning`).

## Documentation officielle

[docs.docker.com](https://docs.docker.com/)

[Retour à l'index des composants](index.md){ .md-button }
