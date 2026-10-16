# Cluster API (core)

**Couche** : Cluster Kubernetes · **Où** : pods du cluster `pad-prod` (auto-hébergé) ; kind pendant le bootstrap · **Version** : v1.14.3 (contrat v1beta2)

## À quoi elle sert ici et pourquoi ce choix

Le cluster `pad-prod` est décrit par des objets Kubernetes (`Cluster`, `TalosControlPlane`, `MachineDeployment`...) et Cluster API crée, met à jour et
détruit ses VM. Il est **auto-hébergé** : après un *pivot*, ses controllers tournent dans `pad-prod` lui-même, il n'y a pas de cluster de gestion permanent
(environ 6 Go de RAM économisés). Décision : [ADR 5](../adr/005-cluster-api.md).

## Où elle tourne et comment elle est déployée

Au bootstrap, `clusterctl init` dans un cluster [kind](kind.md) éphémère installe les providers, puis `clusterctl move` pivote vers `pad-prod`. Ensuite, ArgoCD adopte
les providers à partir de manifestes **rendus et commités** (`gitops/platform/capi-providers`, sync-wave -4) et l'Application `cluster-prod` (vague 5) gère les objets du cluster lui-même.

## Version épinglée

`kubernetes.capi.core: v1.14.3` dans `infra/contracts.yaml`. Rendu des manifestes : `task bootstrap:render-providers`
(`gitops/platform/capi-providers/manifests/core-cluster-api.yaml`). URL de release : `bootstrap/clusterctl.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/clusters/prod/` : `cluster.yaml`, `control-plane.yaml`, `pool-platform.yaml`, `pool-challenges.yaml`, `namespace.yaml`.
- `gitops/platform/capi-providers/` (`application.yaml`, `manifests/`, `README.md`).
- `bootstrap/scripts/cluster.sh`, `capi-common.sh`, `render-providers.sh`, `destroy.sh`.

## Interactions avec les autres briques

Providers associés : [CAPMOX](capmox.md) (infrastructure Proxmox), [CABPT/CACPPT](cabpt-cacppt.md) (bootstrap et control plane Talos), [IPAM in-cluster](ipam-in-cluster.md).
Le [cluster-autoscaler](cluster-autoscaler.md) pilote la taille du `MachineDeployment` `challenges`.

## Sécurité

- Le Secret `capmox-manager-credentials` (jeton Proxmox) est créé au bootstrap depuis SOPS, **jamais** dans Git ni pruné par ArgoCD.
- Garde-fous GitOps : pas de prune ni de finalizer sur l'Application des providers, `Delete=false` sur les CRD et sur le `Cluster`.

## Supervision

Objets `Machine` et `Cluster` observés par kube-state-metrics ; alertes `KubeNodeNotReady`, `ClusterAutoscaler*` : [Autoscaling](../runbooks/autoscaling.md), [Nœuds](../runbooks/kubernetes-nodes.md).

## Opérations courantes

```bash
kubectl -n pad-cluster get cluster,machines,machinedeployments
clusterctl describe cluster pad-prod -n pad-cluster
task bootstrap:render-providers          # après un changement de version dans le contrat
```

## Pièges connus

- Le `Cluster` porte `Delete=false,Prune=false` : supprimer l'Application ArgoCD ne détruit pas les VM ; la destruction passe par `task bootstrap:destroy`.
- L'Application `cluster-prod` ignore `replicas` du pool `challenges` (piloté par l'autoscaler).
- Rotation du jeton Proxmox : modifier le Secret à la main, puis redémarrer `capmox-controller-manager`.
- Réseau des workers : chaque pool de workers est une **zone CAPMOX** (`ProxmoxCluster.spec.zoneConfig` + `network.zone` du template),
  jamais un `ipPoolRef` sur `net0` : CAPMOX force `defaultIPv4: true` sur `net0` et ajouterait une IP du control plane, d'où deux routes
  par défaut (`route already exists for destination/metric`). Détails, cause et réparation : [CAPMOX, pièges connus](capmox.md#pieges-connus).
- Templates d'infrastructure immuables : modifier un `ProxmoxMachineTemplate` appliqué impose de le supprimer puis de le recréer
  (ou de le renommer) ; les `Machine` existantes ne sont pas modifiées, seules les nouvelles utilisent le nouveau template.

## Documentation officielle

[cluster-api.sigs.k8s.io](https://cluster-api.sigs.k8s.io/)

[Retour à l'index des composants](index.md){ .md-button }

- **Modèles immuables** : `ProxmoxMachineTemplate` et `TalosConfigTemplate` refusent toute modification (« Spec is immutable »). Pour changer la configuration des nœuds d'un pool, créer un modèle sous un **nouveau nom** et y faire pointer le `MachineDeployment` (déploiement progressif), ou, au bootstrap, supprimer `MachineDeployment` et modèles puis réappliquer `gitops/clusters/prod`.
- **Heure des nœuds CHALLENGES** : sans egress Internet, ils se synchronisent sur OPNsense (`machine.time.servers: [<passerelle de la zone>]`, règle `m10-chall-ntp`). Symptôme sinon : `talosctl service kubelet` reste en `Waiting for time sync`.
