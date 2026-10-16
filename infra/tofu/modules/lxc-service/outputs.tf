output "containers" {
  description = "LXC créés : vmid, zone, ip, vlan, par nom de service."
  value = {
    for name, svc in var.services : name => {
      vmid = proxmox_virtual_environment_container.this[name].vm_id
      zone = svc.zone
      vlan = svc.vlan
      ip   = split("/", svc.ip_cidr)[0]
    }
  }
}

output "template_file_id" {
  description = "Identifiant Proxmox du template LXC téléchargé."
  value       = proxmox_virtual_environment_download_file.template.id
}
