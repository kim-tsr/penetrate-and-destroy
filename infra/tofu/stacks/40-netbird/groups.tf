# Groupes NetBird.
# - Un groupe par groupe IdP du contrat (identity.groups) : le claim `groups` d'Authentik les alimente (JWT groups).
#   Les créer ici avant la première connexion évite les doublons ; NetBird rattache ensuite les utilisateurs par nom.
# - Groupes techniques `pad-*` : routing peers, ressources de la zone BASTION.
# - Le groupe des ressources d'instances (netbird.network_name) et les groupes d'équipe (ctf-team-<id>) sont
#   créés par apps/netbird-sync (EnsureGroup) : NON déclarés ici.

locals {
  group_players = local.c.netbird.groups.players
  group_staff   = local.c.netbird.groups.staff

  group_routers_challenges = local.c.netbird.technical_groups.routers_challenges
  group_routers_bastion    = local.c.netbird.technical_groups.routers_bastion
  group_bastion_resources  = local.c.netbird.technical_groups.bastion_resources
}

resource "netbird_group" "idp" {
  for_each = toset(local.c.identity.groups)

  name = each.value
}

resource "netbird_group" "routers_challenges" {
  name = local.group_routers_challenges
}

resource "netbird_group" "routers_bastion" {
  name = local.group_routers_bastion
}

resource "netbird_group" "bastion_resources" {
  name = local.group_bastion_resources
}
