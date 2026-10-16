#!/usr/bin/env bash
# Déclenche l'importer OPNsense au premier boot de la VM, par sa console SÉRIE.
#
# L'image nano démarre avec la console série en primaire : le prompt de l'importer
#   "Press any key to start the configuration importer" puis "Select device to import from"
# n'est lisible et ne répond que sur le port série (les frappes VGA via l'API sendkey n'y arrivent pas).
# serial-import.py est donc exécuté SUR L'HÔTE (SSH + sudo) : il ouvre le socket série QEMU de la VM,
# redémarre la VM, attend le texte de l'importer, répond une touche puis "<device><Entrée>", et attend le login.
#
# Variables d'environnement (passées par tofu) :
#   SSH_HOST, SSH_USER (accès SSH à l'hôte, clé dans l'agent), VMID,
#   IMPORT_DEVICE (défaut cd0), IMPORT_TIMEOUT (défaut 600 s).
#
# En cas d'échec : procédure manuelle d'infra/opnsense/README.md (qm terminal <vmid>, 1 minute).
set -euo pipefail

: "${SSH_HOST:?}" "${SSH_USER:?}" "${VMID:?}"
IMPORT_DEVICE="${IMPORT_DEVICE:-cd0}"
IMPORT_TIMEOUT="${IMPORT_TIMEOUT:-600}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh -o BatchMode=yes -o ConnectTimeout=15 "${SSH_USER}@${SSH_HOST}" \
  sudo python3 - "$VMID" "$IMPORT_DEVICE" "$IMPORT_TIMEOUT" <"${here}/serial-import.py"
