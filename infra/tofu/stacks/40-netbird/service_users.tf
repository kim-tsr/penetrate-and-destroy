# Utilisateurs de service. Un PAT hérite du rôle de son propriétaire : un jeton par usage, au rôle minimal.
# Les PAT ne peuvent pas être créés ici (le provider ne crée un token que pour l'utilisateur courant) : à créer dans
# le dashboard (Team > Service Users) et à placer dans les secrets SOPS correspondants.

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
