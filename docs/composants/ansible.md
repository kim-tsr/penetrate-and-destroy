# Ansible

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (connexion SSH vers l'hôte et les LXC) · **Version** : collections épinglées (voir ci-dessous) ; ansible du devshell

## À quoi elle sert ici et pourquoi ce choix

OpenTofu crée les conteneurs ; **Ansible** installe ce qui tourne dedans : durcissement de base, Docker, Alloy puis
le service (Traefik et CrowdSec, NetBird, Warpgate, Authentik, pile de monitoring). Les rôles sont idempotents et
rejouables. Ansible règle aussi l'hôte Proxmox (ARC ZFS, sysctl, exporters). Les secrets sont déchiffrés **par chaque
rôle** (`community.sops`) sur le contrôleur.

## Où elle tourne et comment elle est déployée

Sur le poste de l'opérateur, en deux phases de `task up` :

1. `task ansible:host` : play `host.yml` sur le groupe `proxmox_host` (rôle `host-tuning`) ;
2. `task ansible:services` : play `services.yml`, **un play par LXC**, dans l'ordre monitoring, authentik, warpgate,
   netbird, edge. `task up` le lance en **deux passes** par tags : `monitoring,authentik,edge` avant la stack tofu `30-authentik`,
   puis `monitoring,warpgate,netbird` après `task secrets:oidc-sync` (les secrets OIDC de NetBird, Warpgate et Grafana sont générés par `30-authentik`).

`playbooks/site.yml` enchaîne les deux pour rejouer l'ensemble. Chaque play applique `base-hardening`, `docker`, `alloy`
puis le rôle du service.

## Version épinglée

| Élément | Version | Où |
|---|---|---|
| `community.general` | 13.5.0 | `infra/ansible/requirements.yml` |
| `community.docker` | 5.4.0 | idem |
| `community.sops` | 2.5.0 | idem |
| `ansible.posix` | 2.2.2 | idem |
| images des services | `tag@sha256` | `infra/ansible/inventories/prod/group_vars/all/versions.yml` (`pad_images`) |
| paquets Docker et Alloy (apt) | versions exactes, Docker en `hold` | idem (`pad_apt_versions`) |

`ansible` et `ansible-lint` viennent du devshell ([Nix](nix.md)) ; version minimale des rôles : 2.17.

## Fichiers de configuration dans le dépôt

- `infra/ansible/playbooks/` : `host.yml`, `services.yml`, `site.yml`.
- `infra/ansible/roles/` : `base-hardening`, `docker`, `alloy`, `host-tuning`, `edge-traefik-crowdsec`, `netbird-server`,
  `warpgate`, `authentik`, `monitoring-stack`.
- `infra/ansible/inventories/prod/` : `hosts.example.yml` (hôte), `hosts.generated.yml` (écrit par tofu), `group_vars/all/`
  (`access.yml`, `contracts.yml`, `versions.yml`).
- `infra/ansible/ansible.cfg`, `Taskfile.yml`.

## Interactions avec les autres briques

- Lit l'inventaire généré par [OpenTofu](opentofu.md) et le [contrat](../reference/contrat.md) (`group_vars/all/contracts.yml`).
- Déchiffre les secrets avec [SOPS](sops-age-ksops.md) (clé de l'opérateur).
- Configure [Proxmox](proxmox-ve.md) (hôte) puis [Docker](docker-lxc.md) et les services LXC.

## Sécurité

- Rôle `base-hardening` : sshd par clé uniquement (`MaxAuthTries 3`, pas de forwarding TCP), mises à jour de sécurité
  automatiques sans redémarrage, journald borné (512 Mo, 14 jours).
- Les secrets ne sont lus qu'au moment de l'exécution ; un pré-contrôle échoue si le fichier chiffré du service manque.
- Les valeurs de site (accès SSH à l'hôte) ne sont lues qu'à la connexion (`access.yml`).
- `ansible-lint` au profil `production` est exigé par la CI.

## Supervision

Pas de métrique propre. Les rôles installent **node-exporter** et **Alloy** sur l'hôte et chaque LXC, donc tout ce
qu'Ansible pose est supervisé. Si un play échoue : [Up](../runbooks/up.md) et [Incident](../runbooks/incident.md).

## Opérations courantes

```bash
task ansible:deps                                   # collections épinglées dans .collections/
task ansible:host
task ansible:services -- --tags edge --limit edge   # un seul service
task ansible:lint                                   # ansible-lint + syntax-check, sans contact serveur
```

## Pièges connus

- Warpgate : les réglages SSO faits dans l'UI sont écrasés au prochain passage d'Ansible.
- NetBird s'amorce en deux passes (voir [NetBird](netbird.md)).
- Les paquets Docker sont en `hold` : une montée de version passe par `versions.yml`, pas par apt.

## Documentation officielle

[docs.ansible.com](https://docs.ansible.com/)

[Retour à l'index des composants](index.md){ .md-button }
