output "wan_ip" {
  description = "IP vers laquelle pointent les enregistrements publics."
  value       = local.wan_ip
}

output "records" {
  description = "FQDN publics => IP."
  value       = { for k, r in ovh_domain_zone_record.public : "${r.subdomain}.${r.zone}" => r.target }
}
