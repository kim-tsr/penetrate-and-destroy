# Instances de challenges

Création, renouvellement et destruction d'instances par chall-manager. Cinq alertes : chall-manager arrêté, taux d'erreurs élevé, remplissage du pool d'IP des instances, ou écart entre les instances que CTFd croit actives et les namespaces `inst-*` réels.

## Symptômes

- `ChallManagerDeploymentDown` (critique) : plus aucun pod chall-manager.
- `ChallManagerErrorRate` : plus de 20 % d'opérations en erreur sur 10 minutes.
- `CtfdInstancesDrift` : écart supérieur à 5 entre les instances actives selon CTFd et les namespaces `inst-*` pendant 30 minutes (instances orphelines ou nettoyage bloqué).
- `InstancesLBPoolFilling` (plus de 80 Services LoadBalancer d'instances) et `InstancesLBPoolExhausted` (98 ou plus, critique) : le pool LB-IPAM `instances` (100 adresses) se remplit.
- Des joueurs ne peuvent plus lancer d'instance (502 de l'API, ou 503 « nombre maximal d'instances » : limite globale `instances.max_total`), ou leur instance a disparu.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `ChallManagerDeploymentDown` | critical | 3m | chall-manager n'a plus aucun pod disponible |
| `ChallManagerErrorRate` | warning | 10m | Plus de 20 % d'erreurs dans chall-manager |
| `CtfdInstancesDrift` | warning | 30m | Écart entre les instances de CTFd et celles du cluster |
| `InstancesLBPoolFilling` | warning | 5m | Le pool d'IP des instances est rempli à plus de 80 % |
| `InstancesLBPoolExhausted` | critical | 2m | Le pool d'IP des instances est presque épuisé |

??? info "Expressions PromQL"

    ```promql
    # ChallManagerDeploymentDown
    kube_deployment_status_replicas_available{namespace="chall-manager", deployment="chall-manager"} == 0
    # ChallManagerErrorRate
    sum(rate(traces_spanmetrics_calls_total{service="chall-manager", status_code="STATUS_CODE_ERROR"}[10m])) / clamp_min(sum(rate(traces_spanmetrics_calls_total{service="chall-manager"}[10m])), 1e-9) > 0.2 and sum(rate(traces_spanmetrics_calls_total{service="chall-manager"}[10m])) > 0.01
    # CtfdInstancesDrift
    abs(pad:instances_active - pad:instances_namespaces) > 5
    # InstancesLBPoolFilling
    count(kube_service_spec_type{namespace=~"inst-.+", type="LoadBalancer"} == 1) > 80
    # InstancesLBPoolExhausted
    count(kube_service_spec_type{namespace=~"inst-.+", type="LoadBalancer"} == 1) >= 98
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
2. **Erreurs de création** : (1) image introuvable ou refusée par Zot (`ImagePullBackOff` dans le namespace d'instance) ; (2) pod refusé par Kyverno (PSS restricted : l'image doit tourner en non-root ; `restrict-instance-images` : image sous `registry.pad.internal/ctf/` et épinglée par `@sha256` ; `ResourceQuota` dépassé, voir [Kyverno](kyverno.md)) ; (2b) le nœud challenges ne peut pas tirer l'image faute de règle d'accès Zot `ctf/**` ou d'identifiants de pull ; (3) pool d'adresses `instances` épuisé (`10.20.70.100`-`.199`, 100 adresses) ; (4) plus de nœud disponible, voir [Autoscaling](autoscaling.md).
3. **Dérive** : comparer les namespaces `inst-*` à la liste d'instances (les managers voient les instances de test dans le portail). Un namespace orphelin se détruit avec `kubectl delete ns inst-<id>` après avoir vérifié qu'il n'appartient à aucune instance active ; le finalizer `pad.io/netbird-sync` retire alors la policy NetBird (voir [netbird-sync](netbird-sync.md)).
4. **Instance perdue côté joueur** : l'API `DELETE /api/v1/instances/<challenge_id>` est idempotente ; relancer l'instance depuis l'interface.
5. **Pool d'IP presque plein** : la limite globale CTFd (`instances.max_total`, 90 par défaut, variable `PAD_INSTANCES_MAX_TOTAL`) doit empêcher d'y arriver ; si l'alerte part quand même, chercher des Services orphelins (`kubectl get svc -A | grep inst-`), purger les namespaces orphelins (point 3), puis baisser `max_total`. Pour agrandir le pool, étendre `kubernetes.lb_pools.instances` dans le contrat et `gitops/platform/cilium/resources/lb-ipam.yaml`.
6. Si la cause est un challenge précis, le passer en `hidden` depuis le portail manager le temps de le corriger.

## Escalade

Pendant l'événement, une panne de chall-manager n'empêche pas de scorer les challenges statiques. Annoncer l'incident aux participants des challenges instanciés.

Retour à l'[index des runbooks](index.md).
