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
  description = "Rôle NetBird de l'utilisateur de service utilisé par apps/netbird-sync (groupes, networks, resources, policies). TODO : tester network_admin (moindre privilège) ; admin par défaut car non vérifié."
  type        = string
  default     = "admin"
}

variable "manage_identity_provider" {
  description = "true : tofu porte le connecteur OIDC Authentik et la synchronisation des groupes JWT. false (défaut) : fait par le rôle ansible netbird-server (tasks/idp.yml) ; ne pas activer les deux."
  type        = bool
  default     = false
}
