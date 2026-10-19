# Utilisateurs de service. Un PAT hérite du rôle de son propriétaire : un jeton par usage, au rôle minimal.
# Les PAT sont créés ici (netbird_token, provider >= 0.0.10) et recopiés dans les secrets SOPS de gitops/ par
# `task netbird:sync-tokens` (appelé par la phase 11). Rotation : `tofu apply -replace=netbird_token.<nom>` puis
# netbird:sync-tokens, commit et push (ArgoCD redéploie).

# apps/netbird-sync : groupes, networks, resources, policies, appartenance des pairs aux groupes d'équipe.
# Secret : gitops/apps/netbird-sync (NETBIRD_API_TOKEN).
resource "netbird_user" "netbird_sync" {
  name            = "netbird-sync"
  is_service_user = true
  role            = var.netbird_sync_role
}

# Front (BFF) : lecture de /users et /peers pour afficher l'état du tunnel NetBird du joueur. Lecture seule.
# Secret : gitops/apps/frontend (NETBIRD_API_TOKEN), à ne JAMAIS remplacer par le PAT de netbird-sync ou d'un admin.
resource "netbird_user" "frontend_readonly" {
  name            = "pad-frontend-readonly"
  is_service_user = true
  role            = var.frontend_readonly_role
}

resource "netbird_token" "netbird_sync" {
  user_id         = netbird_user.netbird_sync.id
  name            = "netbird-sync"
  expiration_days = var.service_token_expiration_days
}

resource "netbird_token" "frontend_readonly" {
  user_id         = netbird_user.frontend_readonly.id
  name            = "pad-frontend-readonly"
  expiration_days = var.service_token_expiration_days
}
