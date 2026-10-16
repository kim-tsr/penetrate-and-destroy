output "rules" {
  description = "Règles pass posées (id => description), dans l'ordre de séquence."
  value       = { for id, r in local.pass_rules : format("%05d-%s", r.seq, id) => r.desc }
}

output "port_forwards" {
  description = "Port-forwards WAN."
  value       = { for k, pf in opnsense_firewall_nat_port_forward.wan : k => "${pf.target.ip}:${pf.target.port}" }
}

output "interface_by_zone" {
  description = "Interfaces OPNsense par zone (doit correspondre à l'output du stack 10-router)."
  value       = local.iface
}
