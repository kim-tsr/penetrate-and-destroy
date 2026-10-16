# IPAM in-cluster (Cluster API)

**Couche** : Cluster Kubernetes · **Où** : pods du cluster · **Version** : v1.1.1

## À quoi elle sert ici et pourquoi ce choix

Les nœuds ont des IP statiques (DHCP désactivé partout). Le provider IPAM in-cluster alloue ces adresses à partir de pools `InClusterIPPool`, ce qui évite de
gérer les IP à la main quand le [cluster-autoscaler](cluster-autoscaler.md) ajoute des workers.

## Où elle tourne et comment elle est déployée

Installé par `clusterctl init` (provider IPAM) puis adopté par ArgoCD (`gitops/platform/capi-providers/manifests/ipam-in-cluster.yaml`).

## Version épinglée

`kubernetes.capi.ipam_in_cluster: v1.1.1` dans `infra/contracts.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/clusters/prod/pool-challenges.yaml` et `pool-platform.yaml` : `InClusterIPPool` (plages du contrat : `10.20.70.20-39` pour challenges, `10.20.60.20-39` pour platform).
- Le control plane utilise la plage de `ProxmoxCluster` (`10.20.60.10-14`).

## Interactions avec les autres briques

Référencé par les `ProxmoxMachineTemplate` ([CAPMOX](capmox.md)) ; géré dans le cadre de [Cluster API](cluster-api.md).

## Sécurité

Les plages sont des plages privées du contrat ; une adresse n'est jamais en dehors des zones PROD et CHALLENGES.

## Supervision

Pas de métrique propre ; un pool épuisé bloque la création de machines (voir [Autoscaling](../runbooks/autoscaling.md)).

## Opérations courantes

```bash
kubectl -n pad-cluster get inclusterippools,ipaddresses
```

## Pièges connus

Les plages `ip_pool` du contrat doivent rester synchronisées avec les pools commités ; le pool `challenges` (20 adresses) borne le nombre maximal de workers.

## Documentation officielle

[github.com/kubernetes-sigs/cluster-api-ipam-provider-in-cluster](https://github.com/kubernetes-sigs/cluster-api-ipam-provider-in-cluster)

[Retour à l'index des composants](index.md){ .md-button }
