# Uptime Kuma

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : 2.5.6 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Sonde les services depuis l'extérieur de la pile (DNS, edge, application complets), publie la page de statut publique
(`status.<domaine>`) et reçoit le heartbeat du `Watchdog` : si vmalert, Alertmanager ou le LXC s'arrête, il alerte.

## Où elle tourne et comment elle est déployée

Conteneur du Compose de monitoring (port 3001). Les sondes sont décrites dans `monitoring/uptime-kuma/monitors.yml` et appliquées par `sync.py` (tâche Ansible optionnelle `monitoring_stack_uptime_kuma_sync`).

## Version épinglée

`pad_images.uptime_kuma` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`.

## Fichiers de configuration dans le dépôt

- `monitoring/uptime-kuma/monitors.yml` (valeurs tirées du contrat), `sync.py`, `requirements.txt`.
- `infra/ansible/roles/monitoring-stack/defaults/main.yml` : `monitoring_stack_uptime_kuma_*`.

## Interactions avec les autres briques

Exposé publiquement par [Traefik edge](traefik-edge.md) (page de statut) ; reçoit le Watchdog d'[Alertmanager](alertmanager.md) ; notifie Discord.

## Sécurité

Compte admin créé par `sync.py` (secrets SOPS) ; seule la page de statut est publique, l'UI d'administration ne l'est pas : l'edge ne route que les chemins de la page de statut (`/`, `/status/`, `/api/status-page/`, `/api/entry-page`, ressources statiques ; liste `edge_traefik_crowdsec_status_paths`), le reste répond 404.

## Supervision

Il est lui-même la supervision externe. Limite connue : il vit sur le même LXC que le reste de la pile. Voir [Watchdog](../runbooks/watchdog.md).

## Opérations courantes

```bash
pip install -r monitoring/uptime-kuma/requirements.txt
python3 monitoring/uptime-kuma/sync.py --dry-run     # plan sans connexion
```

## Pièges connus

Désactivé par défaut côté Ansible (`sync: false`) : sans lui, recréer les sondes à la main à partir de `monitors.yml`.

## Documentation officielle

[github.com/louislam/uptime-kuma](https://github.com/louislam/uptime-kuma)

[Retour à l'index des composants](index.md){ .md-button }
