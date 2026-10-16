# Utilisateur de service de apps/netbird-sync. Le PAT ne peut pas être créé ici : le provider ne crée un token
# que pour l'utilisateur courant (qui doit être un service user). Créer le PAT dans le dashboard
# (Team > Service Users > netbird-sync) et le mettre dans le secret SOPS de gitops/apps/netbird-sync.
resource "netbird_user" "netbird_sync" {
  name            = "netbird-sync"
  is_service_user = true
  role            = var.netbird_sync_role
}
