# Proxmox CCM (cloud controller manager)

**Couche** : Cluster Kubernetes · **Où** : pod du cluster sur le control plane (namespace `csi-proxmox`) · **Version** : chart proxmox-cloud-controller-manager 0.2.32 (application v0.16.1)

## À quoi elle sert ici et pourquoi ce choix

Les kubelets Talos tournent avec `cloud-provider: external` (`cluster.externalCloudProvider.enabled`, manifests de
`gitops/clusters/prod/`). Chaque nœud naît donc avec le taint `node.cloudprovider.kubernetes.io/uninitialized:NoSchedule`
et sans `spec.providerID` : tant qu'aucun cloud controller manager ne l'initialise, aucun pod ordinaire n'y est planifié
(cert-manager, Hubble, metrics-server restent `Pending`) et les Machines Cluster API restent en phase `Provisioned`.

Le CCM Proxmox retrouve la VM de chaque nœud par son SMBIOS UUID (`node.status.nodeInfo.systemUUID`) et :

- pose `spec.providerID: proxmox://<uuid>` (mode `capmox`), le format que [CAPMOX](capmox.md) écrit dans
  `ProxmoxMachine.spec.providerID` : [Cluster API](cluster-api.md) relie alors Machine et Node, la Machine passe en `Running` ;
- pose les labels `topology.kubernetes.io/region` et `topology.kubernetes.io/zone` (nom du nœud Proxmox, `host.node`),
  exigés par la StorageClass du [CSI Proxmox](proxmox-csi.md) ;
- retire le taint `uninitialized` ; ensuite (contrôleur `cloud-node-lifecycle`) supprime le Node dont la VM a disparu.

Même auteur et même format de configuration que le CSI : un seul jeton Proxmox pour les deux.

## Où elle tourne et comment elle est déployée

- **Bootstrap** : `bootstrap/scripts/cluster.sh`, étape CNI, juste après Cilium et avant l'attente « nœuds Ready » /
  « cert-manager disponible ». Le script déchiffre `gitops/platform/proxmox-csi/secret.sops.yaml` avec sops (ksops n'existe
  pas encore), l'applique par un pipe (jamais écrit en clair ni affiché), puis installe le chart avec exactement la version
  et les values de l'Application (`helm_from_app`). Voir [Bootstrap](../architecture/bootstrap.md).
- **GitOps** : Application ArgoCD `gitops/platform/proxmox-ccm` (sync-wave -8 : après Cilium, avant cert-manager), qui
  adopte la release `proxmox-ccm`. Un réplica, `nodeSelector` control plane, tolérances control-plane et uninitialized.

## Version épinglée

Chart `proxmox-cloud-controller-manager` 0.2.32 (OCI `ghcr.io/sergelogvinov/charts`) dans
`gitops/platform/proxmox-ccm/application.yaml` ; image `ghcr.io/sergelogvinov/proxmox-cloud-controller-manager:v0.16.1@sha256:474dbfd3…`
dans `values.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/proxmox-ccm/values.yaml` (Secret existant, placement, sécurité, ressources) ; `README.md` (choix du Secret).
- `gitops/platform/proxmox-ccm/resources/podmonitor.yaml` (métriques).
- Aucun Secret propre : `proxmox-csi-config` du CSI (`gitops/platform/proxmox-csi/secret.sops.yaml`, clé `config.yaml`).

## Interactions avec les autres briques

Lit l'API [Proxmox](proxmox-ve.md) (`https://10.20.10.2:8006`, règle OPNsense M9 et pare-feu de l'hôte, egress de la
CiliumNetworkPolicy du namespace `csi-proxmox`) ; écrit sur les Nodes lus par [Cluster API](cluster-api.md) / [CAPMOX](capmox.md)
(providerID), le [CSI Proxmox](proxmox-csi.md) (labels de topologie) et le [cluster-autoscaler](cluster-autoscaler.md)
(nœuds du pool challenges, initialisés de la même façon). Nécessite [Cilium](cilium-hubble.md) (réseau des pods).

## Sécurité

- Lecture seule côté Proxmox : `VM.Audit` (liste et configuration des VM) et `Sys.Audit` (nœuds, groupes HA) du rôle `CSI`
  (guide de déploiement §2.3) suffisent ; aucun privilège ajouté.
- Le Secret est partagé avec le CSI dans le même namespace (pas de copie du jeton). `features.provider` doit valoir `capmox`.
- Pod non root (UID 10258), `readOnlyRootFilesystem`, capacités retirées, seccomp `RuntimeDefault`.
- RBAC du chart (ClusterRole : nœuds, événements, leases, comptes de service). `--use-service-account-credentials=false` :
  tous les contrôleurs utilisent le compte du pod (sinon jetons de comptes de `kube-system`, dont un sans droits).

## Supervision

`PodMonitor` (port 10258 HTTPS, `/metrics`) : `proxmox_api_request_duration_seconds`, `proxmox_api_request_errors_total`.

## Opérations courantes

```bash
kubectl get nodes -o custom-columns=NOM:.metadata.name,PROVIDERID:.spec.providerID,TAINTS:.spec.taints[*].key
kubectl -n csi-proxmox logs deploy/proxmox-cloud-controller-manager
kubectl -n pad-cluster get machines        # phase Running une fois le providerID posé
```

## Pièges connus

- Nœuds avec le taint `node.cloudprovider.kubernetes.io/uninitialized`, pods `Pending` : CCM absent, en échec, ou
  incapable de joindre l'API Proxmox (règle M9, pare-feu de l'hôte, jeton). Voir le dépannage du
  [guide de déploiement](../guide-deploiement.md#9-depannage-transversal).
- `features.provider: default` dans le Secret : le providerID serait `proxmox://<région>/<vmid>`, que CAPMOX ne reconnaît
  pas ; les Machines resteraient en `Provisioned`. Le bootstrap refuse de continuer dans ce cas.
- Le CCM vérifie que le nom de la VM commence par le nom du nœud : CAPMOX nomme la VM comme la Machine, et Talos prend ce
  nom comme hostname ; ne pas renommer les VM à la main.
- Un providerID n'est jamais modifié une fois posé : en cas d'erreur, supprimer le Node (`kubectl delete node`), le kubelet
  le réenregistre et le CCM le réinitialise.

## Documentation officielle

[github.com/sergelogvinov/proxmox-cloud-controller-manager](https://github.com/sergelogvinov/proxmox-cloud-controller-manager)

[Retour à l'index des composants](index.md){ .md-button }
