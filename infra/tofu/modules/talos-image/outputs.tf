output "schematic_id" {
  description = "ID du schematic Image Factory."
  value       = talos_image_factory_schematic.this.id
}

output "installer_image" {
  description = "Image d'installation/upgrade Talos (machine.install.image dans TalosControlPlane/TalosConfigTemplate)."
  value       = data.talos_image_factory_urls.this.urls.installer
}

output "disk_image_url" {
  description = "URL de l'image disque nocloud téléchargée."
  value       = data.talos_image_factory_urls.this.urls.disk_image
}

output "template_vmid" {
  description = "VMID du template (ProxmoxMachineTemplate.spec.template.spec.templateID)."
  value       = proxmox_virtual_environment_vm.template.vm_id
}

output "template_name" {
  description = "Nom du template VM."
  value       = proxmox_virtual_environment_vm.template.name
}
