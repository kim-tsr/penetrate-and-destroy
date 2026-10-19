variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "setup_key_type" {
  description = "Type des setup keys des routing peers : reusable (défaut, bornée par setup_key_usage_limit : rejouable après reconstruction d'un LXC) ou one-off (usage unique : toute reconstruction exige une nouvelle clé, task netbird:rotate-keys)."
  type        = string
  default     = "reusable"

  validation {
    condition     = contains(["one-off", "reusable"], var.setup_key_type)
    error_message = "setup_key_type doit valoir one-off ou reusable."
  }
}

variable "setup_key_expiry_seconds" {
  description = "Durée de validité des setup keys, en secondes (0 = sans expiration). Une clé expirée n'enrôle plus de nouveau pair (les pairs déjà enrôlés ne sont pas affectés) : task netbird:rotate-keys."
  type        = number
  default     = 2592000
}

variable "setup_key_usage_limit" {
  description = "Nombre maximal d'enrôlements par setup key réutilisable (0 = illimité). Ignoré pour one-off. Laisse de la marge pour reconstruire les LXC routeurs."
  type        = number
  default     = 5

  validation {
    condition     = var.setup_key_usage_limit >= 0
    error_message = "setup_key_usage_limit doit être >= 0."
  }
}

variable "routing_peer_metric" {
  description = "Métrique (priorité, plus bas = prioritaire) des routeurs réseau."
  type        = number
  default     = 100
}

variable "staff_bastion_ports" {
  description = "Ports TCP ouverts au staff vers la zone BASTION. Vide = flow_ports.warpgate du contrat (SSH + HTTPS Warpgate)."
  type        = list(number)
  default     = []
}

variable "netbird_sync_role" {
  description = "Rôle NetBird de l'utilisateur de service de apps/netbird-sync (groupes, networks, resources, policies, appartenance des pairs aux groupes d'équipe). network_admin = moindre privilège (pas de gestion des utilisateurs ni des jetons d'autrui). À vérifier au premier déploiement : si l'API répond 403 sur GET /users, repasser à admin (journal de netbird-sync) en acceptant le risque."
  type        = string
  default     = "network_admin"

  validation {
    condition     = contains(["network_admin", "admin"], var.netbird_sync_role)
    error_message = "netbird_sync_role doit valoir network_admin (recommandé) ou admin."
  }
}

variable "frontend_readonly_role" {
  description = "Rôle NetBird de l'utilisateur de service du front (lecture de /users et /peers pour l'état du tunnel). auditor = lecture seule : le jeton du front ne doit jamais hériter des droits d'un administrateur."
  type        = string
  default     = "auditor"

  validation {
    condition     = contains(["auditor"], var.frontend_readonly_role)
    error_message = "frontend_readonly_role doit valoir auditor."
  }
}

variable "manage_identity_provider" {
  description = "true : tofu porte le connecteur OIDC Authentik et la synchronisation des groupes JWT. false (défaut) : fait par le rôle ansible netbird-server (tasks/idp.yml) ; ne pas activer les deux."
  type        = bool
  default     = false
}

variable "service_token_expiration_days" {
  description = "Durée de validité des PAT des utilisateurs de service (jours, maximum NetBird : 365). À renouveler avant échéance (voir service_users.tf)."
  type        = number
  default     = 365
}
