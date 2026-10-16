variable "node_name" {
  description = "Nom du node Proxmox."
  type        = string
}

variable "datastore_id" {
  description = "Datastore des rootfs (contrat : host.datastore_vm)."
  type        = string
}

variable "template_datastore_id" {
  description = "Datastore recevant le template vztmpl (ex : local)."
  type        = string
}

variable "template" {
  description = "Template LXC Debian 13 à télécharger, épinglé par checksum."
  type = object({
    url                = string
    file_name          = string
    checksum           = string
    checksum_algorithm = string
  })
}

variable "bridge" {
  description = "Bridge VLAN-aware des zones (vmbr2)."
  type        = string
}

variable "dns_domain" {
  description = "Domaine de recherche DNS des LXC."
  type        = string
}

variable "ssh_public_keys" {
  description = "Clés publiques SSH injectées pour root (Ansible)."
  type        = list(string)
}

variable "common_tags" {
  description = "Tags Proxmox appliqués à tous les LXC."
  type        = list(string)
  default     = ["pad", "lxc"]
}

variable "services" {
  description = "LXC à créer, indexés par nom de service (= hostname)."
  type = map(object({
    vmid          = number
    zone          = string
    vlan          = number
    ip_cidr       = string # ex : 10.20.20.10/24
    gateway       = string # .1 de la zone (OPNsense)
    cores         = number
    memory_mb     = number
    swap_mb       = optional(number, 512)
    disk_gb       = number
    startup_order = optional(number, 20)
    extra_tags    = optional(list(string), [])
  }))
}
