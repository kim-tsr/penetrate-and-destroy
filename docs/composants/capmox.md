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

- `gitops/clusters/prod/cluster.yaml` (`ProxmoxCluster` : `allowedNodes`, VIP, plage d'IP du control plane dans `ipv4Config`, une zone par pool de
  workers dans `zoneConfig`) ; `control-plane.yaml`, `pool-*.yaml` (`ProxmoxMachineTemplate`, `network.zone` pour les workers).
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
kubectl -n pad-cluster get proxmoxcluster pad-prod -o jsonpath='{.status.inClusterZoneRef}'   # zones et pools IPAM
kubectl -n pad-cluster get ipaddressclaims,inclusterippools                # une seule claim par worker
kubectl -n capmox-system logs deploy/capmox-controller-manager    # namespace indicatif
```

## Pièges connus

- Le template Talos doit exister avant la création des machines (stack `15-talos-image`).
- Les VMID alloués sont dans 300 à 399 ; le template est hors de cette plage pour ne pas être géré par CAPI.
- Les `ProxmoxMachineTemplate` sont **immuables** (webhook CAPMOX) : changer un template déjà appliqué impose de le supprimer et de le
  recréer (ou de le renommer et de mettre à jour la référence du `MachineDeployment`). Un `kubectl apply` du template modifié est refusé.

### Réseau des workers : une seule IP et une seule route par défaut

**Symptôme** : `ProxmoxMachine` d'un worker en `VirtualMachineProvisioned=False`, `VMProvisionFailed: unable to render network-config: route
already exists for destination/metric in routing table` ; VM clonée mais jamais démarrée ; deux `IPAddressClaim` sur `net0` du worker (une dans
`pad-prod-v4-icip`, le pool du control plane, une dans le pool du worker).

**Cause** (code de CAPMOX v0.9.1) :

- le webhook de défaut des `ProxmoxMachine` force `defaultIPv4: true` (et `defaultIPv6: true`) sur `net0` dès qu'aucune interface n'a
  `defaultIPv4: true` ; écrire `defaultIPv4: false` ne sert donc à rien
  ([`proxmoxmachine_webhook.go`, `Default`](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/v0.9.1/internal/webhook/proxmoxmachine_webhook.go#L327-L355)) ;
- `defaultIPv4` réserve une IP dans le pool de la **zone** de la machine (zone `default` = `ProxmoxCluster.spec.ipv4Config`, les IP du control
  plane) et les `ipPoolRef` de l'interface **s'ajoutent** à cette IP au lieu de la remplacer
  ([`ip.go`, `collectDeviceAddresses`](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/v0.9.1/internal/service/vmservice/ip.go#L294-L364)) ;
- chaque IP qui a une passerelle produit une route par défaut ; deux pools avec la même passerelle et la même métrique donnent deux routes
  identiques, que le rendu de la configuration réseau refuse
  ([`pkg/network/errors.go`](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/v0.9.1/pkg/network/errors.go#L33)).
  Avec des passerelles différentes (pool `challenges`), le rendu passerait, mais le worker aurait en plus une IP de la zone PROD sur le VLAN 70.

**Choix retenu** : la méthode documentée par CAPMOX
([*Avoiding this behavior*](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/v0.9.1/docs/advanced-setups.md#avoiding-this-behavior)) :
une **zone CAPMOX par pool de workers** (`ProxmoxCluster.spec.zoneConfig` : `platform`, `challenges`, plages `ip_pool` du contrat) et
`network.zone` dans chaque `ProxmoxMachineTemplate`, sans `ipPoolRef`. Le control plane reste dans la zone `default` (`10.20.60.10-14`).
CAPMOX crée lui-même les `InClusterIPPool` `pad-prod-platform-v4-icip` et `pad-prod-challenges-v4-icip` (possédés par le `ProxmoxCluster`,
donc déplacés avec lui par `clusterctl move`) ; ils ne sont plus dans Git. Chaque nœud a ainsi une seule IP, celle de son pool, et une seule
route par défaut, vers la passerelle de sa zone. Les alias OPNsense construits sur les mêmes `ip_pool` (`host_k8s_cp`, `host_k8s_prod`,
`host_k8s_challenges`) restent exacts : un worker `challenges` n'a plus d'adresse de la zone PROD.

Deux limites de CAPMOX v0.9.1 à connaître :

- `zoneConfig[].dnsServers` est obligatoire mais **non utilisé** pour le rendu : le DNS écrit est celui du `ProxmoxCluster` (Unbound de PROD),
  sauf `dnsServers` sur l'interface. D'où `dnsServers: [10.20.70.1]` sur `net0` du pool `challenges`.
- Bogue d'indice dans [`AddInClusterZoneRef`](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/v0.9.1/api/v1alpha2/proxmoxcluster_types.go#L375-L378) (corrigé en amont par la PR
  [#916](https://github.com/ionos-cloud/cluster-api-provider-proxmox/pull/916), pas encore publiée) : à l'ajout de chaque zone, la
  réconciliation du `ProxmoxCluster` panique une fois (`index out of range`, panique récupérée par controller-runtime) ; le statut partiel est
  tout de même enregistré et la réconciliation suivante aboutit. Attendu : une ou deux erreurs `panic: ... [recovered]` dans les journaux
  de `capmox-controller-manager` après l'application de `cluster.yaml`, puis `status.inClusterZoneRef` du `ProxmoxCluster` liste les zones
  `default`, `platform` et `challenges`. Disparaît avec la version suivante de CAPMOX.

**Réparer un cluster de gestion créé avec l'ancien manifeste** (workers en `VMProvisionFailed`, control plane sain), depuis le dépôt de
l'opérateur à jour, sans recréer le control plane :

```bash
k() { kubectl --kubeconfig .state/kind.kubeconfig -n pad-cluster "$@"; }   # avant le pivot (après : .state/kubeconfig)
# 1. Workers : MachineDeployment -> MachineSet -> Machine -> ProxmoxMachine ; CAPMOX détruit les VM et libère les IPAddressClaim.
k delete machinedeployment pad-prod-platform pad-prod-challenges
k wait --for=delete machine -l 'cluster.x-k8s.io/deployment-name in (pad-prod-platform,pad-prod-challenges)' --timeout=15m
k get machines,proxmoxmachines,ipaddressclaims          # ne restent que le control plane et SA claim
# 2. Templates immuables et anciens pools manuels (bloqués tant qu'une adresse y est allouée)
k delete proxmoxmachinetemplate pad-prod-platform pad-prod-challenges
k delete inclusterippool pad-prod-platform pad-prod-challenges
# 3. Réapplication par le bootstrap (reprenable), puis contrôle
task phase:9-cluster
k get proxmoxcluster pad-prod -o jsonpath='{.status.inClusterZoneRef}'
k get ipaddressclaims -o custom-columns=CLAIM:.metadata.name,POOL:.spec.poolRef.name   # une seule claim par machine
```

## Documentation officielle

[github.com/ionos-cloud/cluster-api-provider-proxmox](https://github.com/ionos-cloud/cluster-api-provider-proxmox)

[Retour à l'index des composants](index.md){ .md-button }
