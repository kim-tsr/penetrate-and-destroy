output "schematic_id" {
  description = "ID du schematic Image Factory (qemu-guest-agent)."
  value       = module.talos_image.schematic_id
}

output "installer_image" {
  description = "Image installer Talos à utiliser dans TalosControlPlane / TalosConfigTemplate (machine.install.image)."
  value       = module.talos_image.installer_image
}

output "template_vmid" {
  description = "VMID du template (ProxmoxMachineTemplate templateID)."
  value       = module.talos_image.template_vmid
}

output "template_name" {
  description = "Nom du template VM."
  value       = module.talos_image.template_name
}
