output "vm_id" {
  description = "VMID de la VM OPNsense."
  value       = proxmox_virtual_environment_vm.this.vm_id
}

output "interface_by_zone" {
  description = "Interface OPNsense (lan, opt1..optN) par zone ; à réutiliser dans les règles de filtrage."
  value       = local.interface_by_zone
}

output "config_sha256" {
  description = "SHA-256 du config.xml rendu (change => nouvel ISO)."
  value       = local.config_sha
}

output "config_iso_file_id" {
  description = "Identifiant Proxmox de l'ISO de config (à détacher/supprimer après bootstrap si souhaité)."
  value       = proxmox_virtual_environment_file.config_iso.id
}
