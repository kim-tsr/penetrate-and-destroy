# Sauvegarde et restauration

`task backup` sauvegarde les deux sources de données de la plateforme : la **base MariaDB de CTFd** et les **buckets
Garage** (`ctfd-uploads` pour les fichiers de challenges, `backups` pour les sauvegardes planifiées de
mariadb-operator). Une réplication vers un S3 externe est optionnelle mais recommandée.

## Ce qui est couvert (et ce qui ne l'est pas)

| Donnée | Sauvegardée par | Où |
|---|---|---|
| Comptes, équipes, scores, soumissions CTFd | `task backup` (dump MariaDB) | `<dir>/mariadb/<horodatage>/ctfd.sql.gz[.age]` |
| Fichiers de challenges | `task backup` (copie rclone de Garage) | `<dir>/garage/<bucket>/` |
| Base d'Authentik (PostgreSQL) | timer `authentik-backup` dans le LXC | `/var/backups/authentik/` (**dans le LXC**, à copier hors machine) |
| Configuration de la plateforme | Git (code) + SOPS (secrets) | dépôt, clés age |
| State OpenTofu | rien d'automatique | `.state/tofu` : à sauvegarder avec sa passphrase |
| Dashboards, règles | Git | `monitoring/` |
| Métriques et logs historiques | rien | perdus à la destruction |

`<dir>` vaut `PAD_BACKUP_DIR` (défaut `.state/backups`, ignoré par Git) **sur le poste opérateur**.

## Sauvegarder

```bash
task backup                          # MariaDB + Garage
task backup -- --only mariadb        # un seul des deux
```

Le dump est écrit en `*.partial` puis renommé (jamais de fichier tronqué), accompagné de son empreinte `.sha256`. Les
14 derniers dumps sont gardés (`PAD_BACKUP_KEEP`). La copie Garage est incrémentale et ne supprime jamais.

### Chiffrer le dump

Un dump contient des données personnelles (e-mails des joueurs) et des empreintes de mots de passe de comptes locaux.
Le chiffrer avant tout stockage hors du poste :

```bash
export PAD_BACKUP_AGE_RECIPIENT="age1...clé-publique"   # une clé publique ; la privée reste hors du dépôt
task backup
```

### Export vers un S3 externe

Définir `PAD_BACKUP_S3_ENDPOINT`, `PAD_BACKUP_S3_BUCKET`, `PAD_BACKUP_S3_ACCESS_KEY_ID` et
`PAD_BACKUP_S3_SECRET_ACCESS_KEY` (et `PAD_BACKUP_S3_REGION`, `PAD_BACKUP_S3_PREFIX`), ou créer le secret chiffré
`secrets/backup-s3.sops.yaml` (`task secrets:init -- --all`). Sans configuration, l'étape est ignorée sans erreur.

### Automatiser

Aucune planification n'est installée : lancer `task backup` avant chaque opération risquée et, pendant un événement,
depuis un `cron` ou un timer du poste opérateur. Les sauvegardes planifiées de mariadb-operator (ressource `Backup`
du cluster) écrivent dans le bucket Garage `backups`, couvert par la copie ci-dessus.

## Vérifier une sauvegarde

Une sauvegarde jamais testée n'est pas une sauvegarde.

```bash
cd .state/backups/mariadb/<horodatage>
sha256sum -c ctfd.sql.gz.sha256
zcat ctfd.sql.gz | head -20        # (ou : age -d -i <identité> ctfd.sql.gz.age | zcat | head -20)
```

Un test de restauration complet se fait sur un cluster de test ou après un [rebuild](rebuild.md).

## Restaurer

```bash
task restore                                          # dernier dump local, MariaDB + Garage
task restore -- --stamp 20261016T120000Z --only mariadb
task restore -- --from external                       # rapatrie d'abord depuis le S3 externe
```

!!! danger "Opération destructive"
    La restauration **écrase** la base `ctfd` (le dump contient `DROP DATABASE`) et recopie les objets Garage.
    Elle demande de taper `restore` (ou `--yes`, ou `PAD_RESTORE_CONFIRM=restore`).

Le script vérifie l'empreinte, déchiffre si besoin (`PAD_BACKUP_AGE_IDENTITY` = fichier d'identité age), importe dans le
pod MariaDB, puis redémarre le Deployment `ctfd` pour vider connexions et caches.

### Sur un cluster neuf

1. Laisser ArgoCD terminer la synchronisation : MariaDB et Garage doivent être `Ready`, et le Job `garage-init` doit
   avoir créé les buckets (`kubectl -n storage get pods`, `kubectl -n ctfd get mariadb`).
2. `task restore`.
3. Vérifier la connexion au front, le scoreboard et le téléchargement d'un fichier de challenge.
4. Les instances de challenges **ne sont pas restaurées** : les joueurs les relancent.

### Authentik

Voir [Authentik](authentik.md) pour restaurer PostgreSQL depuis `/var/backups/authentik`. Sans cette sauvegarde, la
configuration reste reconstructible (stack `30-authentik`), mais les comptes des joueurs sont perdus.
