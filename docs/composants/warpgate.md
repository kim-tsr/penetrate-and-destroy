# Warpgate

**Couche** : Services LXC · **Où** : LXC `warpgate` (zone BASTION, 10.20.30.10) · **Version** : 0.29.2 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Point d'accès unique du personnel aux interfaces internes (SSH des LXC, de l'hôte et d'OPNsense, UI Proxmox et OPNsense).
Il centralise authentification SSO (groupe `infra-admins` via [Authentik](authentik.md)) et journalisation des sessions. La version 0.29 a
été retenue parce que seule cette lignée permet de mapper les groupes OIDC vers les rôles d'administration.

## Où elle tourne et comment elle est déployée

Docker Compose dans le LXC `warpgate` (rôle `warpgate`), données persistantes dans `data/` (SQLite, clés SSH, certificat auto-signé,
`warpgate.yaml`). Ports 2222 (SSH) et 8888 (HTTPS). Rôles et cibles : stack tofu `50-warpgate`.

## Version épinglée

`pad_images.warpgate` (0.29.2) dans `infra/ansible/inventories/prod/group_vars/all/versions.yml` ; provider tofu `warp-tech/warpgate` 1.2.0
([page](tofu-warpgate.md)).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/warpgate/` (`compose.yml.j2`, `warpgate.yaml.j2`, `README.md`).
- `infra/tofu/stacks/50-warpgate/` (`roles.tf`, `targets.tf`).
- `secrets/warpgate.example.yaml` (compte local de secours), `secrets/warpgate-tofu.example.yaml` (jeton d'API).

## Interactions avec les autres briques

- Joignable par le staff **via NetBird** (policy `staff-vers-bastion`), exposé sous `bastion.<domaine>`.
- Atteint les autres zones selon M6 de la [matrice](../architecture/flux.md) (SSH, HTTPS, API Kubernetes, API Talos).
- Un agent NetBird tourne sur ce LXC comme routing peer du réseau `pad-bastion` (rôle `netbird-agent`, phase 11 ; `/dev/net/tun` ajouté par le rôle `lxc-tun`).

## Sécurité

- Conteneur `read_only`, `cap_drop: ALL`, `no-new-privileges`, mémoire bornée.
- SSO Authentik ; utilisateurs créés à la première connexion ; compte local `admin` (mot de passe SOPS) en secours.
- Zone isolée : seul le staff NetBird y accède.

## Supervision

Pas d'exporter Prometheus natif : métriques conteneur via Alloy (cAdvisor) et sonde HTTP d'Uptime Kuma. Panne d'un service :
[Cible injoignable](../runbooks/instance-down.md), [Docker dans un LXC](../runbooks/docker-lxc.md).

## Opérations courantes

```bash
task ansible:services -- --tags warpgate --limit warpgate
task tofu:apply-warpgate
```

## Pièges connus

- OIDC ne couvre que l'interface web ; en SSH, la politique par défaut des utilisateurs SSO est `ssh: [web]` (lien d'authentification à ouvrir).
- `unattended-setup` ne s'exécute qu'une fois ; ensuite Ansible gère `warpgate.yaml` et écrase les réglages SSO de l'UI.
- Les nœuds Talos n'ont pas de SSH : utiliser `talosctl` depuis le bastion.

## Documentation officielle

[warpgate.null.page](https://warpgate.null.page/)

[Retour à l'index des composants](index.md){ .md-button }
