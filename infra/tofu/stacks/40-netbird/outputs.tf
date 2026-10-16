output "group_ids" {
  description = "IDs des groupes NetBird gérés (groupes IdP du contrat + groupes techniques)."
  value = merge(
    { for k, g in netbird_group.idp : k => g.id },
    {
      (local.group_routers_challenges) = netbird_group.routers_challenges.id
      (local.group_routers_bastion)    = netbird_group.routers_bastion.id
      (local.group_bastion_resources)  = netbird_group.bastion_resources.id
    },
  )
}

output "instances_network_id" {
  description = "ID du network des instances (retrouvé par nom par netbird-sync : netbird.network_name)."
  value       = netbird_network.instances.id
}

output "bastion_network_id" {
  description = "ID du network de la zone BASTION."
  value       = netbird_network.bastion.id
}

output "policy_ids" {
  description = "IDs des policies gérées par tofu (les policies d'instances sont gérées par netbird-sync)."
  value       = { staff_to_bastion = netbird_policy.staff_to_bastion.id }
}

output "routing_peer_setup_keys" {
  description = "Setup keys des routing peers (clés : challenges, bastion). À poser dans les secrets SOPS ansible/gitops ; commande : netbird up --setup-key <clé> --management-url <url>."
  value = {
    challenges = netbird_setup_key.routing_challenges.key
    bastion    = netbird_setup_key.routing_bastion.key
  }
  sensitive = true
}

output "netbird_sync_service_user_id" {
  description = "ID de l'utilisateur de service netbird-sync (PAT à créer dans le dashboard)."
  value       = netbird_user.netbird_sync.id
}

output "frontend_readonly_service_user_id" {
  description = "ID de l'utilisateur de service en lecture seule (auditor) du front (PAT à créer dans le dashboard, pour NETBIRD_API_TOKEN du front)."
  value       = netbird_user.frontend_readonly.id
}

output "management_url" {
  description = "URL de l'API management NetBird utilisée par le provider (NETBIRD_API_URL de netbird-sync = cette URL + /api)."
  value       = local.vpn_url
}

output "routing_peers" {
  description = "Routing peers attendus (IP du contrat) et network auquel ils appartiennent."
  value = {
    challenges = { ip = local.c.netbird.routing_peer_ip, zone = local.c.netbird.routing_peer_zone, network = netbird_network.instances.name }
    bastion    = { ip = local.c.services.warpgate.ip, zone = "bastion", network = netbird_network.bastion.name }
  }
}
