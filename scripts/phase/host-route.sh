#!/usr/bin/env bash
# Pose sur l'hôte Proxmox la route vers les zones (10.20.0.0/16 via la passerelle mgmt d'OPNsense), de façon permanente.
#
# Pourquoi : l'hôte n'a qu'une patte en zone mgmt (vmbr2.<vlan>, sans passerelle). Sans cette route, ses réponses vers les autres
# zones partent par sa passerelle par défaut (Internet) : le rebond SSH vers les LXC, l'API Proxmox appelée par CAPMOX et le CSI
# depuis les zones prod/challenges échouent. Le commentaire du module réseau prévoit une pose par Ansible, qui n'existe pas encore.
#
# Idempotent : `ip route replace` + unité systemd `pad-route.service` (oneshot) réécrite à l'identique. À lancer une fois OPNsense
# démarré (phase 2). Usage : scripts/phase/host-route.sh   (via `task host:route`)
set -euo pipefail
# shellcheck source=scripts/phase/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

gw=$(c '.zones.mgmt.gw')
dev="$(c '.host.zones_bridge').$(c '.zones.mgmt.vlan')"
# 10.20.0.0/16 : plage privée commune des zones du contrat (on en déduit les deux premiers octets de la zone mgmt).
cidr="$(c '.zones.mgmt.cidr' | cut -d. -f1-2).0.0/16"

unit=$(
  cat <<EOF
# Géré par scripts/phase/host-route.sh (PenetrateAndDestroy) : route de l'hôte vers les zones, via OPNsense.
[Unit]
Description=PenetrateAndDestroy - route vers les zones via OPNsense
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/ip route replace ${cidr} via ${gw} dev ${dev}
ExecStop=-/usr/sbin/ip route del ${cidr} via ${gw} dev ${dev}

[Install]
WantedBy=multi-user.target
EOF
)

printf '%s\n' "$unit" | host_ssh 'sudo -n tee /etc/systemd/system/pad-route.service >/dev/null && sudo -n systemctl daemon-reload && sudo -n systemctl enable --now pad-route.service && sudo -n systemctl restart pad-route.service'
echo "Route ${cidr} via ${gw} (${dev}) posée sur l'hôte et rendue permanente (pad-route.service)."
host_ssh ip route get "$(c '.kubernetes.control_plane_endpoint')"
