# Stack 00 : réseau de l'hôte (vmbr2 zones, vmbr1 transit si wan=nat, IP mgmt de l'hôte).

module "network" {
  source = "../../modules/proxmox-network"

  node_name      = local.c.host.node
  zones_bridge   = local.c.host.zones_bridge
  transit_bridge = local.c.host.transit_bridge
  wan_mode       = local.c.wan.mode
  transit_cidr   = local.c.wan.transit_cidr

  host_mgmt = {
    vlan    = local.c.zones.mgmt.vlan
    address = "${local.c.host.mgmt_ip}/${split("/", local.c.zones.mgmt.cidr)[1]}"
  }
}
