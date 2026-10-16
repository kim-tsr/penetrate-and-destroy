output "vm_id" {
  description = "VMID de la VM OPNsense."
  value       = module.opnsense.vm_id
}

output "interface_by_zone" {
  description = "Interfaces OPNsense par zone (lan, opt1..opt6), utilisées par 60-opnsense-rules."
  value       = module.opnsense.interface_by_zone
}

output "config_sha256" {
  description = "SHA-256 du config.xml de bootstrap."
  value       = module.opnsense.config_sha256
}

output "api_uri" {
  description = "URI de l'API OPNsense (zone mgmt)."
  value       = "https://${local.c.zones.mgmt.gw}"
}
