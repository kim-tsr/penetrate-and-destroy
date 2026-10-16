# Proxmox CSI

**Couche** : Cluster Kubernetes · **Où** : pods du cluster (namespace `csi-proxmox`) ; node plugin sur tous les nœuds · **Version** : chart proxmox-csi-plugin 0.5.12

## À quoi elle sert ici et pourquoi ce choix

Fournit les `PersistentVolume` (MariaDB, Valkey, Garage, Zot, volume de chall-manager) en créant des disques directement sur le datastore ZFS `local-zfs` de l'hôte. C'est la
StorageClass par défaut `pad-zfs`. Décision : [ADR 10](../adr/010-stockage.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/proxmox-csi` (sync-wave -5), chart OCI. Le node plugin tolère le taint du pool `challenges`.

## Version épinglée

Chart `proxmox-csi-plugin` 0.5.12 dans `gitops/platform/proxmox-csi/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/proxmox-csi/values.yaml` (StorageClass `pad-zfs`, région et zone = nom du nœud) ; `README.md` (création du rôle et du jeton Proxmox).
- `secret.example.yaml` (modèle) ; version chiffrée via ksops (`secret-generator.yaml`).

## Interactions avec les autres briques

Appelle l'API [Proxmox](proxmox-ve.md) (8006) ; consommé par [MariaDB](mariadb.md), [Valkey](valkey.md), [Garage](garage.md), [Zot](zot.md).

## Sécurité

Rôle Proxmox minimal (`CSI`), jeton dédié stocké en Secret SOPS ; l'API n'est atteignable que depuis PROD et CHALLENGES.

## Supervision

Alerte `KubePersistentVolumeFillingUp` : [Charges Kubernetes](../runbooks/kubernetes-workloads.md) ; stockage hôte : [Stockage Proxmox](../runbooks/proxmox-storage.md).

## Opérations courantes

```bash
kubectl get storageclass
kubectl get pvc -A
```

## Pièges connus

- `reclaimPolicy: Delete` : supprimer un PVC supprime le disque ZFS.
- Les nœuds doivent porter les labels de topologie `region` et `zone` égaux au nom du nœud Proxmox.
- Mode `WaitForFirstConsumer` : un PVC reste `Pending` tant qu'aucun pod ne le consomme.

## Documentation officielle

[github.com/sergelogvinov/proxmox-csi-plugin](https://github.com/sergelogvinov/proxmox-csi-plugin)

[Retour à l'index des composants](index.md){ .md-button }
