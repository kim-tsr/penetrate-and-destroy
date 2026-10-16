output "oidc_client_secrets" {
  description = "Secrets OIDC par client (clé = clé du contrat). À recopier dans les secrets SOPS des composants (clé indiquée dans client_secret_targets). NetBird public : absent."
  value       = { for k, r in random_password.client_secret : k => r.result }
  sensitive   = true
}

output "oidc_client_ids" {
  description = "client_id par client (contrat)."
  value       = local.c.identity.oidc_clients
}

output "oidc_issuers" {
  description = "Issuer OIDC par client."
  value       = { for k, id in local.c.identity.oidc_clients : k => "${local.auth_url}/application/o/${id}/" }
}

output "oidc_redirect_uris" {
  description = "Redirect URIs enregistrées par client."
  value       = { for k, v in local.oidc_clients : k => v.redirect_uris }
  sensitive   = true # inclut l'URL de l'API Proxmox (secrets/site.sops.yaml)
}

output "client_secret_targets" {
  description = "Où recopier chaque secret."
  value = {
    frontend = "secret SOPS de gitops/apps/frontend (AUTH_AUTHENTIK_SECRET)"
    netbird  = "secrets/netbird.sops.yaml (secret du connecteur OIDC)"
    warpgate = "secrets/warpgate.sops.yaml"
    grafana  = "secrets/monitoring.sops.yaml (grafana_oidc_client_secret)"
    argocd   = "Secret SOPS argocd-oidc (clé clientSecret)"
    proxmox  = "realm OpenID Proxmox (pveum realm add)"
    ctfd     = "réservé (non utilisé : CTFd headless)"
  }
}

output "internal_ui_fqdns" {
  description = "UIs internes protégées par forward-auth."
  value       = local.internal_ui_fqdns
}
