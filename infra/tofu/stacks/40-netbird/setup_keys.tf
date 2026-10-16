# Setup keys d'enrôlement des routing peers (consommées par ansible / gitops, cf. outputs sensibles).
# Les peers rejoignent automatiquement le groupe de routeurs correspondant.
resource "netbird_setup_key" "routing_challenges" {
  name           = "pad-routing-peer-challenges"
  type           = var.setup_key_type
  expiry_seconds = var.setup_key_expiry_seconds
  auto_groups    = [netbird_group.routers_challenges.id]
  ephemeral      = false
}

resource "netbird_setup_key" "routing_bastion" {
  name           = "pad-routing-peer-bastion"
  type           = var.setup_key_type
  expiry_seconds = var.setup_key_expiry_seconds
  auto_groups    = [netbird_group.routers_bastion.id]
  ephemeral      = false
}
