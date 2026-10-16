# CAPMOX (provider Proxmox)

**Couche** : Cluster Kubernetes · **Où** : pods du cluster (namespace des providers CAPI) · **Version** : v0.9.1 (contrat v1beta2)

## À quoi elle sert ici et pourquoi ce choix

Traduit un `ProxmoxMachine` en VM Proxmox : clone du template Talos, taille CPU, mémoire, disque, réseau (VLAN, IP statique). C'est le provider communautaire
« ionos-cloud » ; il permet de créer et de supprimer des workers à la demande, ce qu'exigent le scaling des challenges et la reconstruction complète.

## Où elle tourne et comment elle est déployée

Installé par `clusterctl init` au bootstrap, puis adopté par ArgoCD (`gitops/platform/capi-providers/manifests/infrastructure-proxmox.yaml`). Il appelle l'API Proxmox (8006) depuis la zone PROD (flux M9).

## Version épinglée

`kubernetes.capi.infrastructure_proxmox: v0.9.1` dans `infra/contracts.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/clusters/prod/cluster.yaml` (`ProxmoxCluster` : `allowedNodes`, VIP, plage d'IP du control plane) ; `control-plane.yaml`, `pool-*.yaml` (`ProxmoxMachineTemplate`).
- `bootstrap/scripts/capi-common.sh` : création du Secret d'identifiants depuis `secrets/proxmox.sops.yaml`.

## Interactions avec les autres briques

Appelle [Proxmox](proxmox-ve.md) ; consomme les objets de [Cluster API](cluster-api.md) ; utilise [IPAM in-cluster](ipam-in-cluster.md) pour les workers.

## Sécurité

Jeton Proxmox dédié, dans un Secret créé hors Git ; l'API Proxmox n'est joignable depuis PROD que sur le port 8006.

## Supervision

Pods dans kube-state-metrics (`KubePodCrashLooping`...) : [Charges Kubernetes](../runbooks/kubernetes-workloads.md). Journaux via [Alloy](alloy.md).

## Opérations courantes

```bash
kubectl -n pad-cluster get proxmoxmachines,proxmoxclusters
kubectl -n capmox-system logs deploy/capmox-controller-manager    # namespace indicatif
```

## Pièges connus

- Le template Talos doit exister avant la création des machines (stack `15-talos-image`).
- Les VMID alloués sont dans 300 à 399 ; le template est hors de cette plage pour ne pas être géré par CAPI.

## Documentation officielle

[github.com/ionos-cloud/cluster-api-provider-proxmox](https://github.com/ionos-cloud/cluster-api-provider-proxmox)

[Retour à l'index des composants](index.md){ .md-button }
