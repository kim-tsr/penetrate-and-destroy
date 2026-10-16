variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "extensions" {
  description = "Extensions officielles Talos du schematic."
  type        = list(string)
  default     = ["siderolabs/qemu-guest-agent"]
}
