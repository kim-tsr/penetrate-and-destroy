# Alertmanager

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : v0.34.1 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Reçoit les alertes de vmalert et les route selon la gravité : `critical` vers Discord et e-mail (rappel 1 h), `warning` vers Discord (4 h),
`info` vers Discord (24 h), `Watchdog` vers le moniteur « push » d'[Uptime Kuma](uptime-kuma.md). Des inhibitions évitent les cascades.

## Où elle tourne et comment elle est déployée

Conteneur du Compose de monitoring (port 9093). Sa configuration contient des secrets : elle est rendue par Ansible (fichier lisible par le groupe `nogroup`).

## Version épinglée

`pad_images.alertmanager` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`.

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/monitoring-stack/templates/alertmanager.yml.j2` (routes, récepteurs, inhibitions) et `alertmanager-pad.tmpl.j2` (messages).
- `monitoring/tests/alertmanager/routes.yml` : cas de routage vérifiés par `amtool config routes test`.
- `secrets/monitoring.example.yaml` : webhooks Discord, SMTP, jeton du Watchdog.

## Interactions avec les autres briques

Reçoit de [vmalert](victoriametrics.md) ; notifie Discord et SMTP ; envoie le Watchdog à [Uptime Kuma](uptime-kuma.md) ; lu par [Grafana](grafana.md).

## Sécurité

- Secrets (webhooks, SMTP) uniquement dans SOPS ; interface en forward-auth Authentik (`alertmanager.<domaine>`).
- Chaque notification renvoie vers un runbook par `runbook_url`.

## Supervision

Alerte `AlertmanagerNotificationsFailing` : [Notifications Alertmanager](../runbooks/alertmanager-notifications.md). Chaîne entière : [Watchdog](../runbooks/watchdog.md).

## Opérations courantes

```bash
bash monitoring/scripts/check.sh      # rend la config avec des secrets factices, amtool check-config, tests de routage
# sur un poste staff : amtool --alertmanager.url=http://10.20.50.10:9093 alert
```

## Pièges connus

Sans `uptime_kuma_watchdog_token`, le récepteur `watchdog` reste vide : l'absence de heartbeat ne prévient personne.

## Documentation officielle

[prometheus.io/docs/alerting](https://prometheus.io/docs/alerting/latest/alertmanager/)

[Retour à l'index des composants](index.md){ .md-button }
