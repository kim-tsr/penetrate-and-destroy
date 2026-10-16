# Groupes du contrat (identity.groups). Le claim OIDC `groups` reprend ces noms (cf. oidc.tf).
# `ctf-players` est le groupe par défaut des inscrits (stage user_write du flow d'enrôlement, cf. flows.tf).

locals {
  groups = toset(local.c.identity.groups)

  g_players = "ctf-players"
  # Groupes autorisés sur les apps staff / ouvertes aux joueurs.
  staff_groups  = ["infra-admins", "ctf-admins"]
  player_groups = local.c.identity.groups
}

resource "authentik_group" "contract" {
  for_each = local.groups

  name = each.value
}
