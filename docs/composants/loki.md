# Loki

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : 3.7.8 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Centralise les logs des LXC, de l'hôte et du cluster (envoyés par [Alloy](alloy.md)) et alimente les panneaux de [Grafana](grafana.md) (dashboard sécurité :
journaux Authentik, par exemple). Choix léger, mono-instance, cohérent avec la pile Grafana.

## Où elle tourne et comment elle est déployée

Conteneur du Compose de monitoring, port 3100. Stockage `filesystem` en TSDB (schéma v13), facteur de réplication 1.

## Version épinglée

`pad_images.loki` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml` ; rétention `monitoring_stack_loki_retention: 336h`
(14 jours) dans `infra/ansible/roles/monitoring-stack/defaults/main.yml`.

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/monitoring-stack/templates/loki.yml.j2` (rétention par le compactor, cache de résultats embarqué).
- `infra/ansible/roles/monitoring-stack/templates/compose.yml.j2`.
- Datasource Grafana : `templates/grafana-datasources.yml.j2`.

## Interactions avec les autres briques

Reçoit de [Alloy](alloy.md) (push 3100) ; lu par [Grafana](grafana.md) ; scrapé par [VictoriaMetrics](victoriametrics.md).

## Sécurité

- `auth_enabled: false` : l'isolement repose sur le réseau (zone MONITORING, push uniquement autorisé par la matrice).
- Journaux au format JSON, `no-new-privileges`.

## Supervision

Alerte `LokiServerErrors` : [Pile de supervision](../runbooks/monitoring-stack.md). Perte de logs côté agent : `AlloyLogsDropped` ([Alloy](../runbooks/alloy-telemetry.md)).

## Opérations courantes

```bash
# requête rapide depuis un poste staff
logcli query '{host="monitoring"}' --addr=http://10.20.50.10:3100
```
Les requêtes habituelles se font dans Grafana, onglet Explore, datasource `loki`.

## Pièges connus

- Sans rétention active (compactor), le disque du LXC (60 Go) se remplit : surveiller `DiskWillFillIn24h`.
- Le suivi des labels Docker dépend de la découverte d'Alloy ; un conteneur renommé change le flux.

## Documentation officielle

[grafana.com/docs/loki](https://grafana.com/docs/loki/latest/)

[Retour à l'index des composants](index.md){ .md-button }
