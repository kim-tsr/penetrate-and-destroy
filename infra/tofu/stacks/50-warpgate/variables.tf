variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "warpgate_api_url" {
  description = "URL de l'API admin Warpgate. Vide = https://<hostnames.bastion>.<domain> (contrat)."
  type        = string
  default     = ""
}

variable "insecure_skip_verify" {
  description = "Ignore la vérification TLS de l'API Warpgate (certificat auto-signé, accès direct par IP)."
  type        = bool
  default     = false
}

variable "access_groups" {
  description = "Groupes Authentik (identity.groups) pour lesquels un rôle Warpgate de même nom est créé et auquel les targets sont ouvertes. Doit contenir infra-admins (role_mappings du rôle ansible warpgate)."
  type        = set(string)
  default     = ["infra-admins"]

  validation {
    condition     = contains(var.access_groups, "infra-admins")
    error_message = "access_groups doit contenir infra-admins (mappé par le rôle ansible warpgate)."
  }
}

variable "lxc_ssh_username" {
  description = "Utilisateur SSH des LXC et d'OPNsense côté target (le rôle ansible utilise root + clé, PermitRootLogin prohibit-password)."
  type        = string
  default     = "root"
}

variable "opnsense_ui_port" {
  description = "Port HTTPS de l'UI web OPNsense (interface MGMT)."
  type        = number
  default     = 443
}

variable "tls_verify_internal" {
  description = "Vérifier le certificat TLS des targets HTTP (UI OPNsense, API Proxmox : auto-signés par défaut, donc false)."
  type        = bool
  default     = false
}
