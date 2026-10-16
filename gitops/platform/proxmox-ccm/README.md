# proxmox-ccm : cloud controller manager Proxmox (initialisation des nœuds)

- Chart `proxmox-cloud-controller-manager` 0.2.32 (OCI `ghcr.io/sergelogvinov/charts`), application v0.16.1, image épinglée
  par empreinte. Namespace `csi-proxmox`, sync-wave -8 (après Cilium, avant cert-manager).
- Les kubelets Talos tournent avec `cloud-provider: external` (`gitops/clusters/prod/*.yaml`) : chaque nœud naît avec le
  taint `node.cloudprovider.kubernetes.io/uninitialized:NoSchedule` et sans `spec.providerID`. Le contrôleur retrouve la VM
  par son SMBIOS UUID, pose `providerID: proxmox://<uuid>` (mode `capmox`, le format que CAPMOX écrit dans
  `ProxmoxMachine.spec.providerID` : la Machine CAPI passe de `Provisioned` à `Running`), les labels
  `topology.kubernetes.io/region` / `zone` (= `host.node`, lus par la StorageClass du CSI), puis retire le taint.
- Contrôleurs actifs : `cloud-node` (initialisation) et `cloud-node-lifecycle` (suppression du Node quand sa VM disparaît).
- Un réplica sur le control plane (`nodeSelector` `node-role.kubernetes.io/control-plane`, tolérances control-plane et
  uninitialized). Réseau des pods : il faut Cilium, installé juste avant par le bootstrap.

## Configuration et jeton : le Secret du CSI

Le contrôleur lit **le même Secret que le CSI**, `proxmox-csi-config` (clé `config.yaml`, namespace `csi-proxmox`,
`gitops/platform/proxmox-csi/secret.sops.yaml`), d'où son namespace. Pourquoi :

- un seul jeton Proxmox (`csi@pve!csi`) et un seul fichier SOPS : pas de copie à faire tourner en double ;
- la règle d'egress vers l'API Proxmox (`10.20.10.2:8006`) de la CiliumNetworkPolicy du namespace sert aux deux ;
- le format de configuration est commun (`features` + `clusters`), et le CSI a lui aussi besoin de
  `features.provider: capmox` pour retrouver la VM d'un nœud dont le providerID est au format CAPMOX.

Privilèges : le contrôleur ne fait que lire (`/cluster/resources`, configuration des VM, groupes HA) : `VM.Audit` et
`Sys.Audit` du rôle CSI suffisent (guide de déploiement §2.3). Pas de privilège à ajouter.

La valeur `features.provider` du Secret **doit** être `capmox` (voir `secret.example.yaml` du CSI) ; le bootstrap refuse de
continuer sinon. Pour la corriger : `sops gitops/platform/proxmox-csi/secret.sops.yaml`.

## Bootstrap

`bootstrap/scripts/cluster.sh` (étape CNI) l'installe juste après Cilium, avec exactement le chart, la version et les values
de `application.yaml` (`helm_from_app`). ksops n'existe pas encore : le script déchiffre
`gitops/platform/proxmox-csi/secret.sops.yaml` avec sops et l'applique par un pipe (jamais écrit en clair, jamais affiché).
ArgoCD adopte ensuite la release (`proxmox-ccm`) et le Secret (Application `proxmox-csi`).

## Choix de déploiement

- `--use-service-account-credentials=false` (via `extraArgs`) : sinon les contrôleurs prendraient des jetons de comptes de
  service de `kube-system`, dont un compte créé à la volée et sans droits (le ClusterRoleBinding du chart vise le compte du
  namespace de la release). Tous les contrôleurs utilisent donc le compte du pod et le ClusterRole du chart.
- Certificat de service généré en mémoire : `readOnlyRootFilesystem: true`.
- Métriques : `PodMonitor` (`resources/podmonitor.yaml`), port 10258 en HTTPS, `/metrics` sans authentification.
