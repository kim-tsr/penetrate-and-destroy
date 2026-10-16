#!/usr/bin/env bash
# Affiche (et régénère si besoin via talosctl) l'accès au cluster pad-prod.
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

if [[ ! -s "$PROD_KUBECONFIG" ]]; then
  [[ -s "$PROD_TALOSCONFIG" ]] || die "ni kubeconfig ni talosconfig dans ${STATE_DIR} : lancer 'task bootstrap:cluster'"
  require_cmd talosctl
  log "régénération du kubeconfig via talosctl"
  (
    umask 077
    talosctl --talosconfig "$PROD_TALOSCONFIG" -n "$(contract '.kubernetes.control_plane_endpoint')" \
      kubeconfig "$PROD_KUBECONFIG" --force
  )
fi
printf 'export KUBECONFIG=%s\nexport TALOSCONFIG=%s\n' "$PROD_KUBECONFIG" "$PROD_TALOSCONFIG"
