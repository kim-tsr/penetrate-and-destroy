# cluster-autoscaler

**Couche** : Cluster Kubernetes · **Où** : pod du cluster (pool platform) · **Version** : chart 9.53.0

## À quoi elle sert ici et pourquoi ce choix

Quand des instances de challenges ne tiennent plus sur les workers existants, l'autoscaler augmente le `MachineDeployment` `challenges` (1 à 3 nœuds) ; il le réduit
quand les nœuds se vident. Il utilise le provider `clusterapi`. Décision : [ADR 6](../adr/006-autoscaling-noeuds.md) ; vue d'ensemble : [Scaling](../architecture/scaling.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/cluster-autoscaler` (chart Helm, sync-wave -3), 1 réplica sur le pool `platform`, mode `incluster-incluster`, découverte automatique du cluster `pad-prod` dans le namespace `pad-cluster`.

## Version épinglée

Chart `cluster-autoscaler` 9.53.0 dans `gitops/platform/cluster-autoscaler/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/cluster-autoscaler/values.yaml` (expander `least-waste`, `scale-down-unneeded-time: 5m`, seuil d'utilisation 0.5).
- `gitops/clusters/prod/pool-challenges.yaml` : annotations `cluster-api-autoscaler-node-group-min-size: "1"` / `max-size: "3"` et capacités déclarées (2 CPU, 2560 Mi).

## Interactions avec les autres briques

Lit les pods en attente de [Kubernetes](cilium-hubble.md) et patche le `MachineDeployment` de [Cluster API](cluster-api.md) ; les VM sont créées par [CAPMOX](capmox.md).

## Sécurité

`runAsNonRoot` (65534), `readOnlyRootFilesystem`, `drop: ALL`, `seccomp: RuntimeDefault`, PodDisruptionBudget (`maxUnavailable: 1`).

## Supervision

ServiceMonitor activé ; alertes `ClusterAutoscaler*` et `HpaMaxedOut` : [Autoscaling](../runbooks/autoscaling.md) ; dashboard `pad-capacity`.

## Opérations courantes

```bash
kubectl -n cluster-autoscaler logs deploy/cluster-autoscaler --tail=50
kubectl -n pad-cluster get machinedeployment
```

## Pièges connus

- Seul le pool `challenges` est autoscalé ; `platform` reste à 2 replicas.
- Le pool `challenges` porte un taint : les pods d'instance doivent le tolérer.
- Le plafond est à 3 nœuds (RAM de l'hôte) : au-delà, les instances restent `Pending`.

## Documentation officielle

[github.com/kubernetes/autoscaler (Cluster API)](https://github.com/kubernetes/autoscaler/tree/master/cluster-autoscaler/cloudprovider/clusterapi)

[Retour à l'index des composants](index.md){ .md-button }
