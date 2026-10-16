# Grafana Alloy

**Couche** : Observabilité · **Où** : hôte Proxmox et chaque LXC (paquet apt), DaemonSet dans le cluster · **Version** : 1.20.1 (paquet `1.20.1-1`, image `v1.20.1`, chart 1.13.1)

## À quoi elle sert ici et pourquoi ce choix

Agent unique de télémétrie : sur l'hôte et les LXC il lit le journal systemd, découvre les conteneurs Docker (logs + cAdvisor) et pousse vers
Loki et VictoriaMetrics ; dans le cluster, un DaemonSet fait le même travail pour les pods et relaie les traces OTLP vers Tempo.

## Où elle tourne et comment elle est déployée

- Hôte et LXC : rôle Ansible `alloy` (paquet apt à version exacte), écoute locale sur 12345.
- Cluster : Application ArgoCD `gitops/platform/alloy` (chart `alloy` 1.13.1), DaemonSet avec tolérations complètes, clustering activé.

## Version épinglée

- Paquet : `pad_apt_versions.alloy` (`1.20.1-1`) dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`.
- Cluster : chart 1.13.1 (`gitops/platform/alloy/application.yaml`), image `grafana/alloy:v1.20.1@sha256:...` (`gitops/platform/alloy/values.yaml`).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/alloy/templates/config.alloy.j2` (journal, `discovery.docker`, cAdvisor, récepteur OTLP).
- `gitops/platform/alloy/values.yaml`.

## Interactions avec les autres briques

Pousse vers [Loki](loki.md), [VictoriaMetrics](victoriametrics.md) et [Tempo](tempo.md) (flux « push » autorisés vers MONITORING par la matrice).

## Sécurité

- Cluster : `runAsNonRoot` (UID 473), `readOnlyRootFilesystem`, `drop: ALL`, `seccomp: RuntimeDefault` ; rapports d'usage désactivés.
- Sur l'hôte, l'UI Alloy n'écoute que sur `127.0.0.1`.

## Supervision

Alertes `AlloyRemoteWriteFailing`, `AlloyLogsDropped`, `ClusterMetricsMissing` : [Télémétrie Alloy](../runbooks/alloy-telemetry.md). Job `alloy` (port 12345).

## Opérations courantes

```bash
task ansible:services -- --tags alloy
kubectl -n observability logs ds/alloy --tail=50
```

## Pièges connus

Dans les LXC, Alloy est posé après Docker pour que la découverte des conteneurs fonctionne (variable `base_hardening_alloy_enabled: false` puis rôle explicite).

## Documentation officielle

[grafana.com/docs/alloy](https://grafana.com/docs/alloy/latest/)

[Retour à l'index des composants](index.md){ .md-button }
