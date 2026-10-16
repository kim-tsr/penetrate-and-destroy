# Tempo

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : 3.1.0 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Reçoit les traces OpenTelemetry du front Next.js, de chall-manager et de son janitor, pour comprendre la latence du cycle
de vie d'une instance. Son générateur de métriques réinjecte des métriques de service dans [VictoriaMetrics](victoriametrics.md).

## Où elle tourne et comment elle est déployée

Conteneur du Compose de monitoring ; OTLP gRPC 4317, OTLP HTTP 4318, API 3200 ; stockage `local`.

## Version épinglée

`pad_images.tempo` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml` ; rétention `monitoring_stack_tempo_retention: 336h`.
En Tempo 3.x, cette rétention se règle sous `backend_scheduler.provider.compaction.compaction.block_retention`
(`tempo.yml.j2`) : l'ancien bloc `compactor` est refusé au démarrage (« field compactor not found in type app.Config »).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/monitoring-stack/templates/tempo.yml.j2`.
- Producteurs : `apps/frontend/src/instrumentation-node.ts`, `gitops/apps/chall-manager/deployment.yaml` (variables `OTEL_*`).

## Interactions avec les autres briques

Reçoit les traces du cluster (via [Alloy](alloy.md) ou en direct), écrit dans VictoriaMetrics ; lu par [Grafana](grafana.md).

## Sécurité

Pas d'authentification applicative : isolement par la zone MONITORING. Les flux OTLP entrants sont ceux de la matrice (4317 et 4318).

## Supervision

Job `tempo` dans VictoriaMetrics ; dashboard `pad-live-ctf` (spans chall-manager). Procédure : [Pile de supervision](../runbooks/monitoring-stack.md).

## Opérations courantes

Les traces se consultent dans Grafana, Explore, datasource `tempo`. Vérifier qu'elles arrivent :
`curl -s http://10.20.50.10:3200/ready` depuis une zone autorisée.

## Pièges connus

Le stockage est local à un LXC unique : pas de haute disponibilité des traces, ce qui est acceptable pour du diagnostic.

## Documentation officielle

[grafana.com/docs/tempo](https://grafana.com/docs/tempo/latest/)

[Retour à l'index des composants](index.md){ .md-button }
