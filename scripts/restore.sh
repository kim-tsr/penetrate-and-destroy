#!/usr/bin/env bash
# Restauration de la base MariaDB de CTFd et des buckets Garage depuis scripts/backup.sh.
#
# USAGE
#   task restore                                         # dernier dump local, MariaDB + Garage (demande confirmation)
#   scripts/restore.sh [--from local|external] [--stamp <stamp>|latest] [--only mariadb|garage|all] [--yes]
#
#   --from local     (défaut) lit PAD_BACKUP_DIR (défaut .state/backups)
#   --from external  lit le S3 externe (mêmes variables que backup.sh) et le rapatrie d'abord en local
#   --stamp          horodatage du dump MariaDB (défaut : latest = le plus récent)
#   --yes            pas de confirmation interactive (ou PAD_RESTORE_CONFIRM=restore)
#
# EFFETS (destructifs, d'où la confirmation explicite)
#   - MariaDB : le dump contient DROP DATABASE / CREATE DATABASE : la base `ctfd` est ÉCRASÉE par le contenu du dump.
#     L'empreinte .sha256 est vérifiée avant import ; un dump chiffré (*.age) exige PAD_BACKUP_AGE_IDENTITY
#     (fichier d'identité age). Ensuite `kubectl rollout restart deployment/ctfd` vide les connexions et caches de CTFd.
#   - Garage : rclone copy du miroir local vers chaque bucket de PAD_BACKUP_BUCKETS (les objets absents de la
#     sauvegarde ne sont pas supprimés). Les buckets doivent exister (Job garage-init d'ArgoCD ; clé S3 = secret-s3.sops.yaml).
#
# IDEMPOTENCE : rejouer la même restauration donne le même état (dump rejoué en entier, copie sans doublon).
#
# CONFIGURATION : identique à scripts/backup.sh (PAD_BACKUP_*, KUBECONFIG, PAD_MARIADB_*), plus
#   PAD_BACKUP_AGE_IDENTITY  fichier d'identité age pour déchiffrer le dump
#   PAD_CTFD_DEPLOYMENT      Deployment à redémarrer (défaut ctfd)
#
# Cas d'un cluster neuf (après `task rebuild`) : laisser ArgoCD finir la synchro (MariaDB et Garage Ready, buckets
# créés par garage-init), puis `task restore`.
# Clés S3 : comme backup.sh (clé de sauvegarde dédiée pour le bucket `backups` si le Secret la contient, sinon clé principale).
set -euo pipefail
# shellcheck source=scripts/lib/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/backup-common.sh"

FROM=local
STAMP=latest
ONLY=all
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:?--from attend local|external}"; shift 2 ;;
    --stamp) STAMP="${2:?--stamp attend une valeur}"; shift 2 ;;
    --only) ONLY="${2:?--only attend mariadb|garage|all}"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done
case "$FROM" in local|external) ;; *) die "--from invalide : $FROM" ;; esac
case "$ONLY" in mariadb|garage|all) ;; *) die "--only invalide : $ONLY" ;; esac
[ "$STAMP" = latest ] || [[ "$STAMP" =~ ^[0-9A-Za-z_-]+$ ]] || die "--stamp invalide : $STAMP"

need kubectl; need gzip; need sha256sum
load_external_s3

if [ "$FROM" = external ]; then
  [ "$EXT_ENABLED" -eq 1 ] || die "S3 externe non configuré (PAD_BACKUP_S3_* ou secrets/backup-s3.sops.yaml)"
  log "S3 externe : rapatriement vers $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR/mariadb" "$BACKUP_DIR/garage"
  if [ "$ONLY" != garage ]; then
    if [ "$STAMP" = latest ]; then
      STAMP="$(rclone_bin lsf --dirs-only "ext:$EXT_BUCKET/$EXT_PREFIX/mariadb" | tr -d '/' | sort | tail -n 1)"
      [ -n "$STAMP" ] || die "aucun dump MariaDB dans le S3 externe"
    fi
    rclone_bin copy "ext:$EXT_BUCKET/$EXT_PREFIX/mariadb/$STAMP" "$BACKUP_DIR/mariadb/$STAMP" --checksum
  fi
  if [ "$ONLY" != mariadb ]; then
    rclone_bin copy "ext:$EXT_BUCKET/$EXT_PREFIX/garage" "$BACKUP_DIR/garage" --checksum --transfers 8
  fi
fi

if [ "$ONLY" != garage ] && [ "$STAMP" = latest ]; then
  STAMP="$(find "$BACKUP_DIR/mariadb" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
  [ -n "$STAMP" ] || die "aucun dump MariaDB dans $BACKUP_DIR/mariadb"
fi

log "Restauration : source=$FROM stamp=${STAMP} cible=${ONLY} cluster=${KUBECONFIG}"
if [ "$YES" -ne 1 ] && [ "${PAD_RESTORE_CONFIRM:-}" != restore ]; then
  [ -t 0 ] || die "confirmation impossible hors terminal : utiliser --yes ou PAD_RESTORE_CONFIRM=restore"
  printf 'Cette opération ÉCRASE la base %s et les objets Garage. Taper "restore" pour continuer : ' "$MARIADB_DATABASE" >&2
  read -r answer
  [ "$answer" = restore ] || die "annulé"
fi

restore_mariadb() {
  local dir="$BACKUP_DIR/mariadb/$STAMP" file
  file="$(find "$dir" -maxdepth 1 -name "$MARIADB_DATABASE.sql.gz*" ! -name '*.sha256' ! -name '*.partial' 2>/dev/null | head -n 1)"
  [ -n "$file" ] || die "dump introuvable dans $dir"
  log "MariaDB : vérification de l'empreinte"
  (cd "$dir" && sha256sum -c "$(basename "$file").sha256" >/dev/null) || die "empreinte invalide pour $file"
  local reader=(cat "$file")
  if [[ "$file" == *.age ]]; then
    need age
    if [ -z "${PAD_BACKUP_AGE_IDENTITY:-}" ] || [ ! -f "$PAD_BACKUP_AGE_IDENTITY" ]; then
      die "dump chiffré : PAD_BACKUP_AGE_IDENTITY (fichier d'identité age) requis"
    fi
    reader=(age -d -i "$PAD_BACKUP_AGE_IDENTITY" "$file")
  fi
  log "MariaDB : import de $(basename "$file") dans $CTFD_NS/$MARIADB_POD"
  # shellcheck disable=SC2016  # $MARIADB_ROOT_PASSWORD doit être résolu dans le pod, pas ici
  "${reader[@]}" | gzip -dc | kubectl -n "$CTFD_NS" exec -i "$MARIADB_POD" -c "$MARIADB_CONTAINER" -- sh -c \
    'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot'
  local deploy="${PAD_CTFD_DEPLOYMENT:-ctfd}"
  if kubectl -n "$CTFD_NS" get "deployment/$deploy" >/dev/null 2>&1; then
    log "CTFd : redémarrage de $deploy"
    kubectl -n "$CTFD_NS" rollout restart "deployment/$deploy" >/dev/null
  fi
}

restore_garage() {
  open_garage
  local b
  for b in $BUCKETS; do
    if [ ! -d "$BACKUP_DIR/garage/$b" ]; then
      log "Garage : pas de sauvegarde locale pour $b, ignoré"
      continue
    fi
    log "Garage : restauration du bucket $b"
    rclone_bin copy "$BACKUP_DIR/garage/$b" "$(garage_remote "$b"):$b" --checksum --transfers 8
  done
  close_garage
}

if [ "$ONLY" != garage ]; then restore_mariadb; fi
if [ "$ONLY" != mariadb ]; then restore_garage; fi
log "Restauration terminée"
