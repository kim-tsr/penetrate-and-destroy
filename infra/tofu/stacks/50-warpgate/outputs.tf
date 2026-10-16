output "api_url" {
  description = "URL de l'API admin Warpgate utilisée par le provider."
  value       = local.api_url
}

output "roles" {
  description = "Rôles Warpgate créés (nom => ID)."
  value       = { for k, r in warpgate_role.access : k => r.id }
}

output "targets" {
  description = "Targets Warpgate créées (nom => ID)."
  value       = local.all_target_ids
}

output "target_access" {
  description = "Rôles autorisés par target."
  value = {
    for t in keys(local.all_target_ids) :
    t => sort([for p in values(local.target_role_pairs) : p.role if p.target == t])
  }
}

output "warpgate_client_public_keys" {
  description = "Clés SSH publiques propres à Warpgate (à ajouter dans authorized_keys des targets SSH pour public_key_auth)."
  value       = data.warpgate_ssh_own_keys.server.keys
}

output "ssh_connection_example" {
  description = "Syntaxe de connexion SSH via Warpgate (utilisateur Warpgate:target). Clé publique ou lien d'autorisation web."
  value       = "ssh -p ${local.c.ports.warpgate.ssh} <utilisateur>:lxc-authentik@${local.c.hostnames.bastion}.${local.c.domain}"
}
