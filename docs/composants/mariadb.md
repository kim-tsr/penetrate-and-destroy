# mariadb-operator et MariaDB

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `ctfd`, StatefulSet), operator dans `mariadb-operator` · **Version** : operator 26.10.1, MariaDB 10.11.19

## À quoi elle sert ici et pourquoi ce choix

CTFd exige MySQL/MariaDB. L'operator pilote le cycle de vie (création, utilisateurs, sauvegardes planifiées, métriques) par des CRD plutôt que par des scripts. Décision :
[ADR 11](../adr/011-bases-de-donnees.md) (MariaDB pour CTFd, Valkey pour le cache).

## Où elle tourne et comment elle est déployée

- Operator : Applications ArgoCD `mariadb-operator-crds` (CRD, vague -5) puis `mariadb-operator` (vague -4).
- Base : CR `MariaDB` `ctfd-mariadb` dans `gitops/apps/ctfd/mariadb.yaml` (1 réplica, volume 10 Gi sur `pad-zfs`).
- Sauvegarde : CR `Backup` toutes les 6 h (`0 */6 * * *`), rétention 168 h, vers le bucket Garage `backups`.

## Version épinglée

| Élément | Version | Où |
|---|---|---|
| charts `mariadb-operator` et `mariadb-operator-crds` | 26.10.1 | `gitops/platform/mariadb-operator/application*.yaml` |
| image de l'operator | `26.10.1@sha256:...` | `gitops/platform/mariadb-operator/values.yaml` |
| image MariaDB | `10.11.19@sha256:...` | `gitops/apps/ctfd/mariadb.yaml` |

## Fichiers de configuration dans le dépôt

- `gitops/platform/mariadb-operator/` (values, deux Applications) ; `gitops/apps/ctfd/mariadb.yaml` (base, utilisateur, `myCnf`, sauvegarde, métriques).
- Secrets : `gitops/apps/ctfd/secret.example.yaml` (`MARIADB_ROOT_PASSWORD`, `DATABASE_PASSWORD`).

## Interactions avec les autres briques

Utilise [Proxmox CSI](proxmox-csi.md) pour le volume et [Garage](garage.md) pour les sauvegardes ; consommée par [CTFd](ctfd.md).

## Sécurité

`runAsNonRoot` (UID 999), `drop: ALL`, `seccomp: RuntimeDefault` ; mots de passe en Secret SOPS ; NetworkPolicy du namespace `ctfd`.

## Supervision

Exporter intégré (`metrics.enabled`) avec ServiceMonitor ; indisponibilité de CTFd : [CTFd](../runbooks/ctfd.md) ; sauvegardes : [Sauvegarde et restauration](../runbooks/backup-restore.md).

## Opérations courantes

```bash
kubectl -n ctfd get mariadb,backups
task backup                       # MariaDB + buckets Garage (scripts/backup.sh)
task restore -- <options>         # avec confirmation (scripts/restore.sh)
```

## Pièges connus

- Un seul réplica : pas de haute disponibilité ; la sauvegarde est la protection.
- Le bucket `backups` est sur le même hôte : exporter hors site avec `secrets/backup-s3` si besoin ([Sauvegarde](../runbooks/backup-restore.md)).
- Sonde de démarrage de `ctfd-mariadb` allongée (5 min) : avec la valeur par défaut (~50 s), la première initialisation
  d'un volume neuf était tuée en cours de route et InnoDB restait corrompu (`ibdata1 ... Data structure corruption`) ;
  il fallait alors supprimer le PVC (vide) pour repartir.

## Documentation officielle

[github.com/mariadb-operator/mariadb-operator](https://github.com/mariadb-operator/mariadb-operator)

[Retour à l'index des composants](index.md){ .md-button }
