# Instances de challenges

Création, renouvellement et destruction d'instances par chall-manager. Trois alertes : chall-manager arrêté, taux d'erreurs élevé, ou écart entre les instances que CTFd croit actives et les namespaces `inst-*` réels.

## Symptômes

- `ChallManagerDeploymentDown` (critique) : plus aucun pod chall-manager.
- `ChallManagerErrorRate` : plus de 20 % d'opérations en erreur sur 10 minutes.
- `CtfdInstancesDrift` : écart supérieur à 5 entre les instances actives selon CTFd et les namespaces `inst-*` pendant 30 minutes (instances orphelines ou nettoyage bloqué).
- Des joueurs ne peuvent plus lancer d'instance (502 de l'API), ou leur instance a disparu.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `ChallManagerDeploymentDown` | critical | 3m | chall-manager n'a plus aucun pod disponible |
| `ChallManagerErrorRate` | warning | 10m | Plus de 20 % d'erreurs dans chall-manager |
| `CtfdInstancesDrift` | warning | 30m | Écart entre les instances de CTFd et celles du cluster |

??? info "Expressions PromQL"

    ```promql
    # ChallManagerDeploymentDown
    kube_deployment_status_replicas_available{namespace="chall-manager", deployment="chall-manager"} == 0
    # ChallManagerErrorRate
    sum(rate(traces_spanmetrics_calls_total{service="chall-manager", status_code="STATUS_CODE_ERROR"}[10m])) / clamp_min(sum(rate(traces_spanmetrics_calls_total{service="chall-manager"}[10m])), 1e-9) > 0.2 and sum(rate(traces_spanmetrics_calls_total{service="chall-manager"}[10m])) > 0.01
    # CtfdInstancesDrift
    abs(pad:instances_active - pad:instances_namespaces) > 5
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n chall-manager get pods
kubectl -n chall-manager logs deploy/chall-manager --tail=100

# Instances réelles
kubectl get ns | grep '^inst-'
kubectl get svc -A --field-selector spec.type=LoadBalancer
kubectl get ciliumloadbalancerippool

# Une instance qui ne démarre pas
kubectl -n inst-<id> get pods,events
```

## Remédiation

1. **chall-manager arrêté** : [Charges Kubernetes](kubernetes-workloads.md). Il est limité à 1 réplica (stockage RWO) : un pod bloqué sur un volume mal détaché est une cause classique.
2. **Erreurs de création** : (1) image introuvable ou refusée par Zot (`ImagePullBackOff` dans le namespace d'instance) ; (2) pod refusé par Kyverno (PSS restricted : l'image doit tourner en non-root, voir [Kyverno](kyverno.md)) ; (3) pool d'adresses `instances` épuisé (`10.20.70.100`-`.199`, 100 adresses) ; (4) plus de nœud disponible, voir [Autoscaling](autoscaling.md).
3. **Dérive** : comparer les namespaces `inst-*` à la liste d'instances (les managers voient les instances de test dans le portail). Un namespace orphelin se détruit avec `kubectl delete ns inst-<id>` après avoir vérifié qu'il n'appartient à aucune instance active ; le finalizer `pad.io/netbird-sync` retire alors la policy NetBird (voir [netbird-sync](netbird-sync.md)).
4. **Instance perdue côté joueur** : l'API `DELETE /api/v1/instances/<challenge_id>` est idempotente ; relancer l'instance depuis l'interface.
5. Si la cause est un challenge précis, le passer en `hidden` depuis le portail manager le temps de le corriger.

## Escalade

Pendant l'événement, une panne de chall-manager n'empêche pas de scorer les challenges statiques. Annoncer l'incident aux participants des challenges instanciés.

Retour à l'[index des runbooks](index.md).
