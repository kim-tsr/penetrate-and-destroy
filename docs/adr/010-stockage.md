# ADR 10 : Stockage : Proxmox CSI et Garage

**Statut** : acceptée.

## Contexte

CTFd stocke des fichiers de challenges et la plateforme doit sauvegarder ses données ; les volumes persistants doivent suivre le cycle de vie des VM.

## Décision

Le **plugin Proxmox CSI** provisionne les volumes sur ZFS. **Garage**, un S3 léger auto-hébergé, héberge les buckets `ctfd-uploads` (fichiers de challenges) et `backups`. Une sauvegarde externe optionnelle réplique le tout vers un S3 distant.

## Alternatives écartées

- **Longhorn ou Ceph** : trop gourmands pour un hôte unique.
- **MinIO** : changements de licence et de gouvernance.
- **Stockage local `hostPath`** : non portable d'un nœud à l'autre.

## Conséquences

- Garage est un point à sauvegarder (`task backup`) ; une panne du pool ZFS est critique ([stockage Proxmox](../runbooks/proxmox-storage.md)).
- Les clés S3 de CTFd doivent encore être fournies en SOPS au Job `garage-init` (voir [limites connues](../reference/limites.md)).
