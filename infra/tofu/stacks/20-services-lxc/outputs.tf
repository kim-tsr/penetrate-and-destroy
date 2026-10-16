output "containers" {
  description = "LXC créés (vmid, zone, vlan, ip) par service."
  value       = module.lxc.containers
}

output "ansible_inventory_path" {
  description = "Chemin de l'inventaire Ansible généré."
  value       = abspath(local_file.ansible_inventory.filename)
}
