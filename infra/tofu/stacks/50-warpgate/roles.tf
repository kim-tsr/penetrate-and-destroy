# Un rôle Warpgate par groupe Authentik autorisé. Le nom du rôle = nom du groupe : le mapping OIDC
# (role_mappings du rôle ansible warpgate) rattache l'utilisateur SSO au rôle d'après le claim `groups`.
# Le rôle d'administration intégré `warpgate:admin` est mappé côté ansible (admin_role_mappings).

# Clés SSH publiques que Warpgate présente aux targets (data source du provider).
data "warpgate_ssh_own_keys" "server" {}

resource "warpgate_role" "access" {
  for_each = var.access_groups

  name        = each.value
  description = "Groupe Authentik ${each.value} (mapping OIDC)"
}
