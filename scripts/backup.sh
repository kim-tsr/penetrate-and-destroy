#!/usr/bin/env bash
# Sauvegarde de la base MariaDB de CTFd et des buckets Garage, avec export optionnel vers un S3 externe.
#
# USAGE
#   task backup                              # tout (MariaDB + Garage)
#   scripts/backup.sh [--only mariadb|garage|all] [--stamp AAAAMMJJTHHMMSSZ] [--force]
#
# CE QUI EST SAUVEGARDÉ
#   - MariaDB : dump logique `mariadb-dump --single-transaction` de la base `ctfd`, exécuté dans le pod MariaDB
#     (kubectl exec : le mot de passe root reste dans le pod), compressé gzip, chiffré par `age` si
#     PAD_BACKUP_AGE_RECIPIENT est défini, accompagné d'un .sha256.
#     Les sauvegardes planifiées du CR `Backup` (mariadb-operator, bucket Garage `backups`) sont couvertes
#     par la copie du bucket `backups` ci-dessous.
#   - Garage : copie incrémentale (rclone copy, jamais de suppression) de chaque bucket de PAD_BACKUP_BUCKETS
#     (défaut : "ctfd-uploads backups") vers <PAD_BACKUP_DIR>/garage/<bucket>.
#     Clé S3 : celle de garage-s3-credentials (access_key_id). Si le Secret contient aussi la clé dédiée aux sauvegardes
#     (backup_access_key_id), elle est utilisée pour le bucket `backups` (le seul où elle a des droits) ; la clé
#     principale reste utilisée pour ctfd-uploads. Sans clé dédiée : la clé principale pour les deux buckets.
#
# DESTINATIONS
#   - Local (toujours) : PAD_BACKUP_DIR (défaut .state/backups, ignoré par git).
#       <dir>/mariadb/<stamp>/ctfd.sql.gz[.age] (+ .sha256) ; <dir>/garage/<bucket>/...
#   - S3 externe (optionnel) : si bucket + clés sont fournis, le local est répliqué sous
#     s3://<bucket>/<prefix>/{mariadb,garage}/... Sans configuration : étape ignorée, sans erreur.
#
# CONFIGURATION (variables d'environnement, ou secrets/backup-s3.sops.yaml chiffré SOPS/age avec les clés
# endpoint, region, bucket, prefix, access_key_id, secret_access_key ; SOPS_AGE_KEY_FILE requis)
#   PAD_BACKUP_S3_ENDPOINT, PAD_BACKUP_S3_REGION, PAD_BACKUP_S3_BUCKET, PAD_BACKUP_S3_PREFIX (défaut "pad"),
#   PAD_BACKUP_S3_ACCESS_KEY_ID, PAD_BACKUP_S3_SECRET_ACCESS_KEY, PAD_BACKUP_S3_PROVIDER (défaut "Other")
#   PAD_BACKUP_AGE_RECIPIENT  clé publique age : chiffre le dump avant tout stockage (recommandé hors du cluster)
#   PAD_BACKUP_KEEP           nombre de dumps MariaDB conservés en local (défaut 14)
#   PAD_BACKUP_DIR, PAD_BACKUP_BUCKETS, KUBECONFIG (défaut .state/kubeconfig)
#   PAD_MARIADB_POD, PAD_MARIADB_CONTAINER, PAD_MARIADB_DATABASE, PAD_CTFD_NAMESPACE, PAD_STORAGE_NAMESPACE
#
# IDEMPOTENCE
#   Relancer avec le même --stamp ne refait pas un dump déjà complet (sauf --force) ; la copie Garage et l'export
#   externe ne transfèrent que les différences. Le dump est écrit en *.partial puis renommé : jamais de fichier tronqué.
#
# PRÉREQUIS : kubectl, gzip, sha256sum, rclone (ou nix), age (si chiffrement), sops (si secrets/backup-s3.sops.yaml).
# Restauration : scripts/restore.sh (task restore).
set -euo pipefail
# shellcheck source=scripts/lib/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/backup-common.sh"

ONLY=all
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:?--only attend mariadb|garage|all}"; shift 2 ;;
    --stamp) STAMP="${2:?--stamp attend une valeur}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done
case "$ONLY" in mariadb|garage|all) ;; *) die "--only invalide : $ONLY" ;; esac
[[ "$STAMP" =~ ^[0-9A-Za-z_-]+$ ]] || die "--stamp invalide : $STAMP"

need kubectl; need gzip; need sha256sum
load_external_s3
mkdir -p "$BACKUP_DIR"

backup_mariadb() {
  local dir="$BACKUP_DIR/mariadb/$STAMP" ext=".sql.gz" out
  if [ -n "${PAD_BACKUP_AGE_RECIPIENT:-}" ]; then need age; ext=".sql.gz.age"; fi
  out="$dir/$MARIADB_DATABASE$ext"
  if [ -s "$out" ] && [ -s "$out.sha256" ] && [ "$FORCE" -eq 0 ]; then
    log "MariaDB : dump $STAMP déjà présent, ignoré (--force pour refaire)"
    return 0
  fi
  mkdir -p "$dir"
  log "MariaDB : dump de la base $MARIADB_DATABASE depuis $CTFD_NS/$MARIADB_POD"
  # Le mot de passe root est lu dans l'environnement du pod (rootPasswordSecretKeyRef de l'opérateur) : il ne transite pas ici.
  local dump=(kubectl -n "$CTFD_NS" exec "$MARIADB_POD" -c "$MARIADB_CONTAINER" -- sh -c
    "MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb-dump -uroot --single-transaction --routines --events --triggers --add-drop-database --databases '$MARIADB_DATABASE'")
  if [ -n "${PAD_BACKUP_AGE_RECIPIENT:-}" ]; then
    "${dump[@]}" | gzip -9 | age -r "$PAD_BACKUP_AGE_RECIPIENT" >"$out.partial"
  else
    "${dump[@]}" | gzip -9 >"$out.partial"
  fi
  [ -s "$out.partial" ] || { rm -f "$out.partial"; die "dump vide"; }
  mv "$out.partial" "$out"
  (cd "$dir" && sha256sum "$(basename "$out")" >"$(basename "$out").sha256")
  log "MariaDB : $out ($(wc -c <"$out") octets)"

  # Rétention locale : on garde les PAD_BACKUP_KEEP dumps les plus récents (les stamps se trient chronologiquement).
  local keep="${PAD_BACKUP_KEEP:-14}" old
  while IFS= read -r old; do
    if [ -n "$old" ]; then
      log "MariaDB : suppression de l'ancien dump $old"
      rm -rf "${BACKUP_DIR:?}/mariadb/$old"
    fi
  done < <(find "$BACKUP_DIR/mariadb" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +"$((keep + 1))")
}

backup_garage() {
  open_garage
  local b
  for b in $BUCKETS; do
    log "Garage : copie du bucket $b"
    mkdir -p "$BACKUP_DIR/garage/$b"
    rclone_bin copy "$(garage_remote "$b"):$b" "$BACKUP_DIR/garage/$b" --fast-list --transfers 8 --checksum
  done
  close_garage
}

export_external() {
  if [ "$EXT_ENABLED" -ne 1 ]; then
    log "S3 externe : non configuré, export ignoré"
    return 0
  fi
  log "S3 externe : réplication vers s3://$EXT_BUCKET/$EXT_PREFIX"
  if [ "$ONLY" != garage ] && [ -d "$BACKUP_DIR/mariadb/$STAMP" ]; then
    rclone_bin copy "$BACKUP_DIR/mariadb/$STAMP" "ext:$EXT_BUCKET/$EXT_PREFIX/mariadb/$STAMP" --checksum
  fi
  if [ "$ONLY" != mariadb ] && [ -d "$BACKUP_DIR/garage" ]; then
    rclone_bin copy "$BACKUP_DIR/garage" "ext:$EXT_BUCKET/$EXT_PREFIX/garage" --checksum --transfers 8
  fi
}

if [ "$ONLY" != garage ]; then backup_mariadb; fi
if [ "$ONLY" != mariadb ]; then backup_garage; fi
export_external
log "Sauvegarde terminée (stamp $STAMP)"
