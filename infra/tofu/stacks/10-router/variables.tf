variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "opnsense_images" {
  description = <<-EOT
    Images nano OPNsense connues, par version (router.version du contrat).
    sha256 = celui du .img.bz2, tiré de OPNsense-<v>-checksums-amd64.sha256 (miroir officiel).
  EOT
  type = map(object({
    url    = string
    sha256 = string
  }))
  default = {
    "25.7" = {
      url    = "https://pkg.opnsense.org/releases/25.7/OPNsense-25.7-nano-amd64.img.bz2"
      sha256 = "f58f57da42a2a6d445b6e04780572d6e2d6d9ceaff8a9e5f7bbefd0fedeaa3c0"
    }
  }
}

variable "auto_import" {
  description = "Déclencher automatiquement l'importer OPNsense au premier boot (sendkey via l'API Proxmox)."
  type        = bool
  default     = true
}
