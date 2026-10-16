# Garage (S3)

**Couche** : Plateforme GitOps · **Où** : pod du cluster (StatefulSet `garage-0`, namespace `storage`) · **Version** : v2.4.1

## À quoi elle sert ici et pourquoi ce choix

CTFd envoie les fichiers de challenges et de téléversement vers un bucket S3, et les sauvegardes MariaDB vont dans un second bucket. Garage est un S3 léger, mono-nœud
possible, bien plus petit que MinIO. Décision : [ADR 10](../adr/010-stockage.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/garage` (vague -2), un nœud (`replicationFactor: 1`, base LMDB), données 20 Gi sur `pad-zfs`. Un **Job PostSync** `garage-init` assigne le layout
(18 Go), crée les buckets `ctfd-uploads` et `backups`, **importe** la clé S3 du Secret `garage-s3-credentials` et lui donne lecture/écriture sur ces deux buckets. Si le Secret contient aussi la clé de sauvegarde dédiée (`backup_access_key_id`, facultative), le Job l'importe sous le nom `pad-backups`,
lui donne seule accès au bucket `backups` et retire cet accès à la clé de CTFd ; `scripts/backup.sh` et `restore.sh` s'en servent alors pour ce bucket.

## Version épinglée

Image `dxflrs/amd64_garage:v2.4.1@sha256:...` dans `gitops/platform/garage/values.yaml` (et `targetRevision: v2.4.1` de la source chart dans `application.yaml`).

## Fichiers de configuration dans le dépôt

- `gitops/platform/garage/values.yaml`, `manifests/job-init.yaml`, `manifests/rbac.yaml`.
- `secret-s3.example.yaml` (clé d'accès) et `secret-rpc.example.yaml` (secret RPC) ; générateur ksops.
- Contrat : `apps.garage` (endpoint S3 interne, région `garage`) et `apps.ctfd.upload_bucket` / `backup_bucket`.

## Interactions avec les autres briques

Utilisé par [CTFd](ctfd.md) (`UPLOAD_PROVIDER=s3`, accès path-style) et par la sauvegarde de [MariaDB](mariadb.md) ; volumes via [Proxmox CSI](proxmox-csi.md). `scripts/backup.sh` et `restore.sh` relisent la clé.

## Sécurité

Conteneur `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ALL` ; clé S3 limitée à deux buckets ; endpoint interne uniquement (ClusterIP).

## Supervision

Probes TCP ; état du StatefulSet via kube-state-metrics : [Charges Kubernetes](../runbooks/kubernetes-workloads.md) ; remplissage : `KubePersistentVolumeFillingUp`.

## Opérations courantes

```bash
kubectl -n storage exec garage-0 -c garage -- /garage status
kubectl -n storage exec garage-0 -c garage -- /garage bucket list
```

## Pièges connus

- Un seul nœud, pas de redondance : les sauvegardes doivent être exportées ailleurs.
- La clé S3 est générée une fois et recopiée dans le Secret de CTFd : pour la faire tourner, modifier les deux fichiers SOPS avec les mêmes valeurs ([Secrets](../SECRETS.md)).
- Image `amd64` uniquement (cluster Talos x86_64).

## Documentation officielle

[garagehq.deuxfleurs.fr](https://garagehq.deuxfleurs.fr/documentation/)

[Retour à l'index des composants](index.md){ .md-button }
