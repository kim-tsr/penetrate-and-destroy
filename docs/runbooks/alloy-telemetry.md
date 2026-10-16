# Télémétrie Alloy

Alloy est l'agent de collecte : un service systemd sur l'hôte et chaque LXC, un DaemonSet dans le cluster. Il pousse métriques, logs et traces vers le LXC monitoring.

## Symptômes

- Trous dans les dashboards d'un hôte ou d'un LXC, logs manquants dans Loki.
- `AlloyRemoteWriteFailing` / `AlloyLogsDropped` : le label `host` désigne l'agent qui perd des données.
- `ClusterMetricsMissing` (critique) : plus aucune métrique `kube_node_info`, donc plus aucune supervision du cluster.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `AlloyLogsDropped` | warning | 10m | Alloy perd des logs (envoi Loki en échec) |
| `AlloyRemoteWriteFailing` | warning | 10m | Alloy perd des métriques (remote_write en échec) |
| `ClusterMetricsMissing` | critical | 15m | Plus aucune métrique du cluster Kubernetes |

??? info "Expressions PromQL"

    ```promql
    # AlloyLogsDropped
    sum by (host) (rate(loki_write_dropped_entries_total[5m])) > 0
    # AlloyRemoteWriteFailing
    sum by (host) (rate(prometheus_remote_storage_samples_failed_total[5m])) > 0
    # ClusterMetricsMissing
    absent(kube_node_info)
    ```

## Diagnostic

```bash
# Agent d'un LXC ou de l'hôte
systemctl status alloy
journalctl -u alloy --since "30 min ago" | tail -50
curl -s http://localhost:12345/-/ready

# Le puits est-il joignable depuis cette zone ? (règle M7)
curl -s -o /dev/null -w '%{http_code}\n' http://10.20.50.10:8428/health
curl -s -o /dev/null -w '%{http_code}\n' http://10.20.50.10:3100/ready

# Dans le cluster
kubectl -n observability get ds,pods -o wide
kubectl -n observability logs ds/alloy --tail=50
kubectl -n observability get pods -l app.kubernetes.io/name=kube-state-metrics
```

## Remédiation

1. Puits injoignable (code 000) : règle M7 manquante ou OPNsense indisponible, voir [OPNsense indisponible](opnsense-down.md). Réappliquer `task tofu:apply-stack STACK=60-opnsense-rules` si la règle a disparu.
2. Puits en erreur (5xx) : voir [Pile de supervision](monitoring-stack.md) (disque plein de VictoriaMetrics ou Loki).
3. Agent bloqué : `systemctl restart alloy` ; pour le DaemonSet, laisser ArgoCD réconcilier (`kubectl -n observability rollout restart ds/alloy` est toléré, il ne change pas le dépôt).
4. `ClusterMetricsMissing` : si les pods Alloy tournent, vérifier kube-state-metrics et la NetworkPolicy de scrape ; si le cluster entier est down, passer à [Nœuds Kubernetes](kubernetes-nodes.md).
5. Erreurs de certificat kubelet : point connu à valider sur cluster réel (voir [limites connues](../reference/limites.md)).

## Escalade

Si `ClusterMetricsMissing` dure plus de 15 minutes sans cause trouvée, supposer une panne du cluster et suivre le [runbook d'incident](incident.md).

Retour à l'[index des runbooks](index.md).
