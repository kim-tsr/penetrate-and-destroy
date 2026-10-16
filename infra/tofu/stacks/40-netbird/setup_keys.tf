# Setup keys d'enrôlement des routing peers, consommées par le rôle ansible netbird-agent (task netbird:sync-keys les
# recopie dans secrets/netbird-agent.sops.yaml). Les peers rejoignent automatiquement le groupe de routeurs correspondant.
# Réutilisables et bornées par défaut : reconstruire un LXC consomme un usage, sans recréer la clé. Jamais éphémères :
# un peer éphémère est supprimé après 10 minutes hors ligne et le réseau perdrait son routeur.
resource "netbird_setup_key" "routing_challenges" {
  name           = "pad-routing-peer-challenges"
  type           = var.setup_key_type
  expiry_seconds = var.setup_key_expiry_seconds
  usage_limit    = var.setup_key_type == "reusable" ? var.setup_key_usage_limit : null
  auto_groups    = [netbird_group.routers_challenges.id]
  ephemeral      = false
}

resource "netbird_setup_key" "routing_bastion" {
  name           = "pad-routing-peer-bastion"
  type           = var.setup_key_type
  expiry_seconds = var.setup_key_expiry_seconds
  usage_limit    = var.setup_key_type == "reusable" ? var.setup_key_usage_limit : null
  auto_groups    = [netbird_group.routers_bastion.id]
  ephemeral      = false
}
