# Réseau de l'hôte Proxmox pour PenetrateAndDestroy.
# - vmbr2 : bridge VLAN-aware SANS uplink. Seul OPNsense (NIC trunk) route entre les VLANs des zones.
# - vmbr1 : bridge de transit host <-> OPNsense, uniquement en mode wan = nat (DNAT nftables posé par Ansible).
# - vmbr2.<vlan mgmt> : IP de l'hôte dans la zone MGMT (API Proxmox joignable par PROD via OPNsense).

resource "proxmox_virtual_environment_network_linux_bridge" "zones" {
  node_name  = var.node_name
  name       = var.zones_bridge
  vlan_aware = true
  vids       = "2-4094"
  ports      = []
  autostart  = true
  mtu        = var.mtu
  comment    = "pad: zones VLAN-aware, sans uplink, routées par OPNsense"
}

resource "proxmox_virtual_environment_network_linux_bridge" "transit" {
  count = var.wan_mode == "nat" ? 1 : 0

  node_name = var.node_name
  name      = var.transit_bridge
  address   = "${cidrhost(var.transit_cidr, 1)}/${split("/", var.transit_cidr)[1]}"
  ports     = []
  autostart = true
  comment   = "pad: transit WAN host <-> OPNsense (mode nat)"
}

resource "proxmox_virtual_environment_network_linux_vlan" "host_mgmt" {
  count = var.host_mgmt == null ? 0 : 1

  node_name = var.node_name
  name      = "${var.zones_bridge}.${var.host_mgmt.vlan}"
  interface = proxmox_virtual_environment_network_linux_bridge.zones.name
  vlan      = var.host_mgmt.vlan
  address   = var.host_mgmt.address
  autostart = true
  comment   = "pad: IP de l'hôte en zone mgmt (pas de gateway : route 10.20.0.0/16 posée par Ansible)"
}
