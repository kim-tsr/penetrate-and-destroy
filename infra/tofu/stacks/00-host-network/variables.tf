variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}
