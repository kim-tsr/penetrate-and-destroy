# Groupes du contrat (identity.groups). Le claim OIDC `groups` reprend ces noms (cf. oidc.tf).
# `ctf-players` est le groupe par défaut des inscrits (stage user_write du flow d'enrôlement, cf. flows.tf).

locals {
  groups = toset(local.c.identity.groups)

  g_players = "ctf-players"
  # Séparation des privilèges :
  #  - infra_groups : administration de l'infrastructure (ArgoCD, Warpgate, Grafana, Proxmox, forward-auth) ;
  #    uniquement `infra-admins`. `ctf-admins` (organisateurs d'un événement) n'y a PAS accès.
  #  - event_admin_groups : administration de l'événement CTF (admin CTFd).
  #  - player_groups : front et NetBird, ouverts à tous les groupes du contrat.
  infra_groups       = ["infra-admins"]
  event_admin_groups = ["ctf-admins", "infra-admins"]
  player_groups      = local.c.identity.groups

  # Groupes soumis à la MFA obligatoire (TOTP ou WebAuthn) : tout compte à privilèges.
  mfa_groups = ["ctf-managers", "ctf-admins", "infra-admins"]
}

resource "authentik_group" "contract" {
  for_each = local.groups

  name = each.value
}
