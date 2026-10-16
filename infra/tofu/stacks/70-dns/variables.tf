variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "record_ttl" {
  description = "TTL (secondes) des enregistrements A publics."
  type        = number
  default     = 300
}
