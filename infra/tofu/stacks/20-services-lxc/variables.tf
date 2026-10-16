variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "lxc_template" {
  description = "Template LXC Debian 13 (index aplinfo pve-9 : http://download.proxmox.com/images/aplinfo-pve-9.dat)."
  type = object({
    url                = string
    file_name          = string
    checksum           = string
    checksum_algorithm = string
  })
  default = {
    url                = "http://download.proxmox.com/images/system/debian-13-standard_13.6-1_amd64.tar.zst"
    file_name          = "debian-13-standard_13.6-1_amd64.tar.zst"
    checksum           = "4c0c27ca6ceab5ef0b84db57825a00f26157ef1854bafe97297813e1cbe8ecb8cc9c453cab6b3b0efe1ba193a50c47ece1e41d950e411b8730b835b71e9e754b"
    checksum_algorithm = "sha512"
  }
}
