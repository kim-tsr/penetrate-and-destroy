# Intégration IdP Authentik (OIDC) + synchronisation des groupes JWT.
# Désactivé par défaut : le rôle ansible netbird-server (tasks/idp.yml) fait déjà ces deux opérations via l'API.
# Activer var.manage_identity_provider pour migrer vers tofu (et retirer alors le PAT owner d'ansible).
locals {
  netbird_server_secrets = var.manage_identity_provider ? yamldecode(data.sops_file.netbird_server[0].raw) : {}
}

resource "netbird_identity_provider" "authentik" {
  count = var.manage_identity_provider ? 1 : 0

  name          = "Authentik"
  type          = "oidc"
  client_id     = local.c.identity.oidc_clients.netbird
  client_secret = local.netbird_server_secrets.netbird_server_authentik_client_secret
  issuer        = "${local.auth_url}/application/o/${local.c.identity.oidc_clients.netbird}/"
}

resource "netbird_account_settings" "jwt_groups" {
  count = var.manage_identity_provider ? 1 : 0

  jwt_groups_enabled    = true
  jwt_groups_claim_name = "groups"
  jwt_allow_groups      = local.c.identity.groups
}
