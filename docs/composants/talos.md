# Talos Linux

**Couche** : Cluster Kubernetes · **Où** : VM Proxmox (control plane en zone PROD, workers PROD et CHALLENGES) · **Version** : v1.11.3 (Kubernetes v1.34.1)

## À quoi elle sert ici et pourquoi ce choix

Talos n'a ni SSH, ni shell, ni gestionnaire de paquets : tout passe par son API (`talosctl`). La surface d'attaque est minimale et la
configuration des nœuds est du code, ce qui convient à un cluster jetable. Les nœuds sont créés à partir d'un **template** construit avec un
schematic Image Factory contenant uniquement `qemu-guest-agent`. Décision : [ADR 4](../adr/004-talos.md).

## Où elle tourne et comment elle est déployée

La stack tofu `15-talos-image` télécharge l'image Talos (provider `siderolabs/talos`) et crée la VM *template* sur Proxmox. Ensuite
[Cluster API](cluster-api.md) la clone pour chaque nœud ; la configuration machine est générée par [CABPT/CACPPT](cabpt-cacppt.md) et passée en
cloud-init (datasource `nocloud`). Le control plane expose une **VIP** (`10.20.60.5`) et le kubeconfig/talosconfig sont extraits dans `.state/`.

## Version épinglée

| Élément | Valeur | Où |
|---|---|---|
| Talos | v1.11.3 | `infra/contracts.yaml` (`kubernetes.talos_version`) |
| Kubernetes | v1.34.1 | `kubernetes.kubernetes_version` |
| schematic Image Factory | `ce4c9805...c7515` | `kubernetes.talos_schematic_id` |
| image d'installation | `factory.talos.dev/nocloud-installer/<schematic>:v1.11.3` | `kubernetes.talos_installer_image` |
| provider tofu | `siderolabs/talos` 0.12.0 | `infra/tofu/stacks/15-talos-image/versions.tf` |

## Fichiers de configuration dans le dépôt

- `infra/tofu/modules/talos-image/` et `infra/tofu/stacks/15-talos-image/` (schematic, téléchargement, VM template).
- `gitops/clusters/prod/control-plane.yaml` (patch de configuration : VIP, kubelet, `cni: none`, `proxy.disabled`, KubePrism, certificats serveur du kubelet).
- `gitops/clusters/prod/pool-platform.yaml` et `pool-challenges.yaml` (workers).
- `bootstrap/scripts/kubeconfig.sh` : extraction du kubeconfig et du talosconfig.

## Interactions avec les autres briques

- Créé par [CAPMOX](capmox.md) sur [Proxmox](proxmox-ve.md) ; reçoit sa config de [CABPT/CACPPT](cabpt-cacppt.md).
- Sans CNI ni kube-proxy : [Cilium](cilium-hubble.md) les remplace (KubePrism sur le port 7445).
- Les flux d'administration (API Talos 50000, trustd 50001) viennent du bastion ([matrice](../architecture/flux.md)).

## Sécurité

- Pas de SSH ni de shell ; API Talos accessible uniquement depuis le bastion.
- `allowSchedulingOnControlPlanes: false` : le control plane ne porte aucune charge.
- Certificats serveur du kubelet signés (`rotate-server-certificates`) avec l'approbateur `kubelet-serving-cert-approver` v0.12.1.
- Le pool `challenges` porte le taint `pad.io/pool=challenges:NoSchedule`, héberge les instances de joueurs et son kubelet est borné : `podPidsLimit: 256` (fork bomb), `maxPods: 40` (remplissage du disque), feature gate `UserNamespacesSupport` et sysctl `user.max_user_namespaces`
  pour les pods `hostUsers: false` (valeurs du contrat `instances.*`). Un changement du patch ne remplace pas les machines existantes : créer un nouveau `TalosConfigTemplate`.
- Les namespaces Cluster API (`pad-cluster`, fournisseurs CAPI, `csi-proxmox`) sont en PSS et en NetworkPolicy default-deny.

## Supervision

Alertes `KubeNodeNotReady`, `KubeNodePressure` : [Nœuds Kubernetes](../runbooks/kubernetes-nodes.md). Métriques par [node-exporter](exporters.md).

## Opérations courantes

```bash
task bootstrap:kubeconfig               # exports KUBECONFIG et TALOSCONFIG
talosctl --nodes <ip> health
talosctl --nodes <ip> dmesg | tail
```

## Pièges connus

- Changer la version de Talos : modifier le contrat **et** rejouer `15-talos-image` (nouveau template) avant de toucher aux MachineDeployments.
- `extraManifests` télécharge deux manifestes depuis Internet au premier démarrage du control plane.
- L'image d'installation doit rester cohérente avec le schematic (sinon `qemu-guest-agent` disparaît).

## Documentation officielle

[talos.dev/docs](https://www.talos.dev/latest/)

[Retour à l'index des composants](index.md){ .md-button }
