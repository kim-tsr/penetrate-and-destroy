# Matrice de flux côté NetBird.
# - Joueurs -> IPs LB des instances : policies par instance et par équipe créées par apps/netbird-sync (phase 2).
#   Aucune policy joueurs ici : sans policy d'instance, un joueur n'atteint rien.
# - Staff -> BASTION uniquement.
# La policy « Default » (All <-> All) créée par NetBird doit être supprimée (cf. README) : deny all par défaut.
# Le provider ne permet pas de l'adopter sans connaître son ID (non vérifié contre le registry, bloqué ici) : la
# suppression reste une étape manuelle OBLIGATOIRE, mais elle est vérifiée automatiquement : apps/netbird-sync refuse
# de démarrer, et n'écrit plus rien dans NetBird, tant qu'une policy active a le groupe « All » en source.

locals {
  staff_bastion_ports = length(var.staff_bastion_ports) > 0 ? var.staff_bastion_ports : local.c.flow_ports.warpgate
}

resource "netbird_policy" "staff_to_bastion" {
  name        = "staff-vers-bastion"
  description = "Staff (infra-admins) vers la zone BASTION (Warpgate) uniquement"
  enabled     = true

  rule {
    name          = "staff-vers-bastion"
    action        = "accept"
    bidirectional = false
    enabled       = true
    protocol      = "tcp"
    ports         = [for p in local.staff_bastion_ports : tostring(p)]
    sources       = [netbird_group.idp[local.group_staff].id]
    destinations  = [netbird_group.bastion_resources.id]
  }
}
