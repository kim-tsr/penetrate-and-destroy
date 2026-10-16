variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "setup_key_type" {
  description = "Type des setup keys des routing peers : one-off (usage unique, recommandé) ou reusable."
  type        = string
  default     = "one-off"

  validation {
    condition     = contains(["one-off", "reusable"], var.setup_key_type)
    error_message = "setup_key_type doit valoir one-off ou reusable."
  }
}

variable "setup_key_expiry_seconds" {
  description = "Durée de validité des setup keys, en secondes (0 = sans expiration)."
  type        = number
  default     = 604800
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
