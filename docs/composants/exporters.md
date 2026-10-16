# Exporters (node, pve, kube-state-metrics, Docker)

**Couche** : Observabilité · **Où** : hôte, LXC et cluster · **Version** : node-exporter v1.12.1 (cluster), kube-state-metrics v2.20.0, pve-exporter (PyPI, épinglé)

## À quoi elle sert ici et pourquoi ce choix

Ces petits exporters donnent les métriques de base : **node-exporter** (CPU, mémoire, disque, ZFS ARC) sur l'hôte, chaque LXC et chaque nœud ;
**pve-exporter** (état des invités et du stockage Proxmox, hôte seulement) ; **kube-state-metrics** (état des objets Kubernetes) ; **métriques du démon Docker**
(9323) ; **os-node_exporter** d'OPNsense (9100). Le chart `prometheus-operator-crds` apporte uniquement les CRD `ServiceMonitor` et `PodMonitor`.

## Où elle tourne et comment elle est déployée

- LXC et hôte : paquet apt `prometheus-node-exporter` (rôle `base-hardening`), `prometheus-pve-exporter` installé depuis PyPI (pas de paquet Debian sur Proxmox 9) dans un virtualenv `/opt/prometheus-pve-exporter`, version épinglée par `host_tuning_pve_exporter_version`, lancé par un service systemd `prometheus-pve-exporter`, + utilisateur `pve-exporter@pve` en lecture seule (`PVEAuditor`) (rôle `host-tuning`).
- Cluster : Applications ArgoCD `kube-state-metrics`, `node-exporter`, `prometheus-crds`.

## Version épinglée

| Élément | Version | Où |
|---|---|---|
| chart `kube-state-metrics` | 8.6.0, image v2.20.0 | `gitops/platform/kube-state-metrics/application.yaml`, `values.yaml` |
| chart `prometheus-node-exporter` | 4.60.0, image v1.12.1@sha256 | `gitops/platform/node-exporter/` |
| chart `prometheus-operator-crds` | 32.0.1 | `gitops/platform/prometheus-crds/application.yaml` |
| node-exporter des hôtes ; pve-exporter de l'hôte | paquet Debian ; PyPI (virtualenv) | `infra/ansible/roles/base-hardening`, `host-tuning` |

## Fichiers de configuration dans le dépôt

- `gitops/platform/kube-state-metrics/`, `gitops/platform/node-exporter/`, `gitops/platform/prometheus-crds/`.
- `infra/ansible/roles/base-hardening/defaults/main.yml` (écoute du node-exporter), `infra/ansible/roles/host-tuning/tasks/pve_exporter.yml`.
- Ports : `monitoring.exporters` dans `infra/contracts.yaml`.

## Interactions avec les autres briques

Scrapés par [VictoriaMetrics](victoriametrics.md) (LXC et hôte directement, cluster via [Alloy](alloy.md)).

## Sécurité

- L'exporter de l'hôte est lié à l'IP MGMT, pas à l'IP publique ; pve-exporter a un jeton Proxmox en lecture seule.
- Les ports d'exporters (9000-9999) ne sont ouverts qu'en scrape MONITORING vers les zones.

## Supervision

Alerte `InstanceDown` (cible muette) : [Cible injoignable](../runbooks/instance-down.md) ; `KubeNodeNotReady` : [Nœuds Kubernetes](../runbooks/kubernetes-nodes.md).

## Opérations courantes

```bash
curl -s http://<ip du LXC>:9100/metrics | head      # depuis la zone MONITORING
kubectl -n observability get pods
```

## Pièges connus

Le jeton pve-exporter n'est recréé que si `/etc/prometheus/pve.yml` est absent : supprimer ce fichier pour forcer la rotation.

## Documentation officielle

[prometheus.io/docs/instrumenting/exporters](https://prometheus.io/docs/instrumenting/exporters/)

[Retour à l'index des composants](index.md){ .md-button }
