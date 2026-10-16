# Charges Kubernetes

Pods, Deployments et volumes des namespaces de la plateforme (hors namespaces d'instances `inst-*`, qui sont exclus de ces alertes).

## Symptômes

- `KubePodCrashLooping`, `KubePodOOMKilled`, `KubePodNotReady` (Pending/Unknown/Failed depuis 20 minutes).
- `KubeDeploymentUnavailable` (critique, aucun réplica disponible), `KubeDeploymentReplicasMismatch`.
- `KubePersistentVolumeFillingUp` : un volume est presque plein.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `KubeDeploymentReplicasMismatch` | warning | 20m | Deployment &lt;namespace&gt;/&lt;deployment&gt; incomplet |
| `KubeDeploymentUnavailable` | critical | 5m | Deployment &lt;namespace&gt;/&lt;deployment&gt; sans réplica disponible |
| `KubePersistentVolumeFillingUp` | warning | 15m | Volume &lt;namespace&gt;/&lt;persistentvolumeclaim&gt; presque plein |
| `KubePodCrashLooping` | warning | 15m | Pod &lt;namespace&gt;/&lt;pod&gt; en CrashLoopBackOff |
| `KubePodNotReady` | warning | 20m | Pod &lt;namespace&gt;/&lt;pod&gt; bloqué |
| `KubePodOOMKilled` | warning | immédiat | Conteneur &lt;namespace&gt;/&lt;pod&gt;/&lt;container&gt; tué par OOM |

??? info "Expressions PromQL"

    ```promql
    # KubeDeploymentReplicasMismatch
    kube_deployment_spec_replicas{namespace!~"inst-.+"} != kube_deployment_status_replicas_available{namespace!~"inst-.+"}
    # KubeDeploymentUnavailable
    kube_deployment_spec_replicas{namespace!~"inst-.+"} > 0 and kube_deployment_status_replicas_available{namespace!~"inst-.+"} == 0
    # KubePersistentVolumeFillingUp
    kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes < 0.10 and kubelet_volume_stats_capacity_bytes > 0
    # KubePodCrashLooping
    max_over_time(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}[5m]) >= 1
    # KubePodNotReady
    sum by (namespace, pod) ( kube_pod_status_phase{phase=~"Pending|Unknown|Failed", namespace!~"inst-.+"} ) > 0
    # KubePodOOMKilled
    (increase(kube_pod_container_status_restarts_total[15m]) > 0) and on (namespace, pod, container) (kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1)
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl get pods -A | grep -vE 'Running|Completed'
kubectl -n <ns> describe pod <pod> | sed -n '/State:/,/Ready:/p;/Events/,$p'
kubectl -n <ns> logs <pod> --previous --tail=100
kubectl -n <ns> get events --sort-by=.lastTimestamp | tail -20

kubectl top pods -n <ns> 2>/dev/null
kubectl -n <ns> get pvc
```

## Remédiation

1. **CrashLoopBackOff** : lire `logs --previous` : configuration, Secret manquant, base indisponible. Corriger dans le dépôt.
2. **OOMKilled** : relever `resources.limits.memory` dans `gitops/` (par commit) ; chercher d'abord une fuite.
3. **Pending** : `describe` indique la cause (ressources insuffisantes, taint/toleration, volume non attaché, refus Kyverno). Voir [Autoscaling](autoscaling.md) pour les nœuds.
4. **Volume plein** : augmenter la taille de la demande (`PersistentVolumeClaim`) dans le dépôt, si la StorageClass Proxmox CSI autorise l'extension ; sinon nettoyer les données.
5. **Régression d'image** : `git revert` du commit fautif.
6. Les correctifs passent par Git : un `kubectl edit` est écrasé par ArgoCD.

## Escalade

Un Deployment indisponible sur `ctfd`, `frontend` ou `chall-manager` a son propre runbook : [CTFd](ctfd.md), [Front](frontend.md), [Instances](instances.md).

Retour à l'[index des runbooks](index.md).
