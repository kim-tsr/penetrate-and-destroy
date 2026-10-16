output "zones_bridge" {
  description = "Bridge VLAN-aware des zones."
  value       = module.network.zones_bridge
}

output "transit_bridge" {
  description = "Bridge de transit (mode nat uniquement)."
  value       = module.network.transit_bridge
}

output "host_mgmt_interface" {
  description = "Interface de l'hôte en zone mgmt."
  value       = module.network.host_mgmt_interface
}
