#!/usr/bin/env bash
# Déclenche l'importer OPNsense au premier boot de la VM, via l'API Proxmox (sendkey), sans accès console.
#
# Au boot, /usr/local/etc/rc lance `opnsense-importer -b`, qui affiche
#   "Press any key to start the configuration importer: ......."   (~7 s, lit 1 octet avec dd)
# puis demande "Select device to import from:" (lecture d'une ligne ; un device invalide => nouvelle question).
#
# Stratégie : après BOOT_DELAY, on tape en boucle "<device><Entrée>" (ex : "cd0\n") toutes les CYCLE secondes
# pendant BOOT_WINDOW secondes :
#   - le 1er caractère reçu pendant l'attente ouvre l'importer (consommé par dd) ;
#   - le reste ("d0\n") est un device invalide => l'importer redemande ;
#   - le cycle suivant ("cd0\n") est valide => /conf/config.xml est copié depuis l'ISO, et le boot continue.
# Les frappes en trop finissent sur le prompt de login console (sans effet).
#
# Variables d'environnement (passées par tofu ; le jeton ne passe jamais en argument) :
#   PVE_ENDPOINT (https://host:8006), PVE_API_TOKEN (user@realm!id=secret), PVE_INSECURE (true/false),
#   PVE_NODE, VMID, BOOT_DELAY (défaut 15), BOOT_WINDOW (défaut 120), CYCLE (défaut 3), IMPORT_DEVICE (défaut cd0).
#
# Méthode best-effort : si le timing échoue, voir infra/opnsense/README.md (procédure manuelle, 1 minute).
set -euo pipefail

: "${PVE_ENDPOINT:?}" "${PVE_API_TOKEN:?}" "${PVE_NODE:?}" "${VMID:?}"
BOOT_DELAY="${BOOT_DELAY:-15}"
BOOT_WINDOW="${BOOT_WINDOW:-120}"
CYCLE="${CYCLE:-3}"
IMPORT_DEVICE="${IMPORT_DEVICE:-cd0}"

curl_opts=(-sS --fail -H "Authorization: PVEAPIToken=${PVE_API_TOKEN}")
[ "${PVE_INSECURE:-false}" = "true" ] && curl_opts+=(-k)
api="${PVE_ENDPOINT%/}/api2/json/nodes/${PVE_NODE}/qemu/${VMID}"

sendkey() { curl "${curl_opts[@]}" -X PUT --data-urlencode "key=$1" "${api}/sendkey" >/dev/null || true; }

echo "Attente du démarrage de la VM ${VMID}..."
for _ in $(seq 1 60); do
  if curl "${curl_opts[@]}" "${api}/status/current" | grep -q '"status":"running"'; then break; fi
  sleep 2
done

sleep "$BOOT_DELAY"
echo "Envoi de '${IMPORT_DEVICE}<Entrée>' toutes les ${CYCLE}s pendant ${BOOT_WINDOW}s..."
end=$(($(date +%s) + BOOT_WINDOW))
while [ "$(date +%s)" -lt "$end" ]; do
  for ((i = 0; i < ${#IMPORT_DEVICE}; i++)); do
    sendkey "${IMPORT_DEVICE:i:1}"
  done
  sendkey ret
  sleep "$CYCLE"
done
echo "Import demandé. Vérifier https://<gw mgmt> ; sinon suivre la procédure manuelle du README."
