output "zones_bridge" {
  description = "Nom du bridge des zones."
  value       = proxmox_virtual_environment_network_linux_bridge.zones.name
}

output "transit_bridge" {
  description = "Nom du bridge de transit (null hors mode nat)."
  value       = one(proxmox_virtual_environment_network_linux_bridge.transit[*].name)
}

output "host_mgmt_interface" {
  description = "Interface VLAN de l'hôte en zone mgmt (null si absente)."
  value       = one(proxmox_virtual_environment_network_linux_vlan.host_mgmt[*].name)
}
