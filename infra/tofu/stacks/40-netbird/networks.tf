# Réseau des instances de challenges (zone CHALLENGES) : portée par le routing peer de netbird.routing_peer_ip.
# Les resources (IP LB /32) et les policies par instance sont créées dynamiquement par apps/netbird-sync,
# qui retrouve ce réseau par son nom (netbird.network_name) : ne rien déclarer d'autre ici.
resource "netbird_network" "instances" {
  name        = local.c.netbird.network_name
  description = "Instances de challenges (resources et policies gérées par netbird-sync)"
}

resource "netbird_network_router" "instances" {
  network_id  = netbird_network.instances.id
  peer_groups = [netbird_group.routers_challenges.id]
  metric      = var.routing_peer_metric
  masquerade  = true
  enabled     = true
}

# Réseau BASTION : le staff n'atteint que la zone BASTION (matrice de flux), via un routing peer dans cette zone.
resource "netbird_network" "bastion" {
  name        = local.c.netbird.bastion_network_name
  description = "Zone BASTION (Warpgate), accessible au staff uniquement"
}

resource "netbird_network_router" "bastion" {
  network_id  = netbird_network.bastion.id
  peer_groups = [netbird_group.routers_bastion.id]
  metric      = var.routing_peer_metric
  masquerade  = true
  enabled     = true
}

resource "netbird_network_resource" "bastion_zone" {
  network_id  = netbird_network.bastion.id
  name        = "zone-bastion"
  description = "CIDR de la zone BASTION (contrat zones.bastion)"
  address     = local.c.zones.bastion.cidr
  groups      = [netbird_group.bastion_resources.id]
  enabled     = true
}
