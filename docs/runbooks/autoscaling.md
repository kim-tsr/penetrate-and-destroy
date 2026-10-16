# Autoscaling (KEDA, HPA, cluster-autoscaler)

Trois mécanismes : KEDA (réplicas de CTFd, front, chall-manager), l'HPA qu'il génère, et le cluster-autoscaler (nœuds du pool `challenges`). Voir [Scaling](../architecture/scaling.md).

## Symptômes

- `KedaScalerErrors` : KEDA n'arrive pas à lire une métrique (VictoriaMetrics injoignable ou requête invalide).
- `HpaMaxedOut` : le maximum de réplicas est atteint depuis 30 minutes : la charge dépasse la capacité prévue.
- `ClusterAutoscalerUnschedulablePods` : des pods attendent un nœud depuis 20 minutes (en pratique, des instances de challenges).
- `ClusterAutoscalerErrors` / `ClusterAutoscalerFailedScaleUp` : l'ajout de nœud échoue.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `ClusterAutoscalerErrors` | warning | 15m | Le cluster-autoscaler remonte des erreurs (&lt;type&gt;) |
| `ClusterAutoscalerFailedScaleUp` | warning | immédiat | Échec d'ajout de nœud par le cluster-autoscaler |
| `ClusterAutoscalerUnschedulablePods` | warning | 20m | Pods non planifiables depuis 20 minutes |
| `HpaMaxedOut` | info | 30m | HPA &lt;namespace&gt;/&lt;horizontalpodautoscaler&gt; au maximum de réplicas |
| `KedaScalerErrors` | warning | 10m | Erreurs de scaler KEDA pour &lt;scaledObject&gt; |

??? info "Expressions PromQL"

    ```promql
    # ClusterAutoscalerErrors
    increase(cluster_autoscaler_errors_total[15m]) > 0
    # ClusterAutoscalerFailedScaleUp
    increase(cluster_autoscaler_failed_scale_ups_total[30m]) > 0
    # ClusterAutoscalerUnschedulablePods
    cluster_autoscaler_unschedulable_pods_count > 0
    # HpaMaxedOut
    kube_horizontalpodautoscaler_status_current_replicas >= kube_horizontalpodautoscaler_spec_max_replicas
    # KedaScalerErrors
    increase(keda_scaler_detail_errors_total[10m]) > 0
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl get scaledobject -A
kubectl get hpa -A
kubectl -n keda logs deploy/keda-operator --tail=50

# Pods en attente et raison
kubectl get pods -A --field-selector=status.phase=Pending
kubectl describe pod -n <ns> <pod> | sed -n '/Events/,$p'

# Cluster-autoscaler et Cluster API
kubectl -n cluster-autoscaler get pods
kubectl -n cluster-autoscaler logs deploy/<nom-du-deployment> --tail=80
kubectl -n pad-cluster get machinedeployment,machine
kubectl -n pad-cluster describe machine <machine> | tail -30
```

## Remédiation

1. **KEDA** : tester la requête de `gitops/apps/<app>/scaledobject.yaml` sur VictoriaMetrics (`curl -G http://10.20.50.10:8428/api/v1/query --data-urlencode 'query=...'`). Une métrique absente (exporter CTFd, front) se traite dans [CTFd](ctfd.md) ou [Front](frontend.md).
2. **Plafond atteint** : relever `maxReplicaCount` dans le `ScaledObject` (par commit) si les nœuds `platform` ont de la marge, sinon ajouter de la capacité. Calibrer les seuils avec `task load`.
3. **Pas de nœud ajouté** : (1) `max-size` du pool atteint, relever le maximum dans le contrat et `gitops/clusters/prod/pool-challenges.yaml` ; (2) RAM de l'hôte insuffisante, voir [Hôte Proxmox](proxmox-host.md) ; (3) la `Machine` reste `Provisioning` : CAPMOX n'arrive pas à cloner, voir l'état de la machine et l'API Proxmox (règle M9) ; (4) plage `ip_pool` épuisée.
4. **Pods Pending sans scale-up** : les instances exigent la toleration `pad.io/pool=challenges`. Un pod sans cette toleration ne se planifie pas sur le pool et l'autoscaler ne l'aide pas.

## Escalade

Pendant un événement, un pic d'instances qui attendent un nœud allonge simplement les lancements de quelques minutes. Si l'événement est en cours, informer les joueurs et envisager d'abaisser temporairement les quotas d'instances par équipe.

Retour à l'[index des runbooks](index.md).
