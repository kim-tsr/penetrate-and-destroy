variable "node_name" {
  description = "Nom du node Proxmox."
  type        = string
}

variable "zones_bridge" {
  description = "Nom du bridge VLAN-aware des zones (ex : vmbr2)."
  type        = string
}

variable "transit_bridge" {
  description = "Nom du bridge de transit WAN (mode nat uniquement, ex : vmbr1)."
  type        = string
}

variable "wan_mode" {
  description = "Mode WAN d'OPNsense : routed_ip (IP publique routée vers la VM sur vmbr0) ou nat (transit vmbr1)."
  type        = string

  validation {
    condition     = contains(["routed_ip", "nat"], var.wan_mode)
    error_message = "wan_mode doit valoir routed_ip ou nat."
  }
}

variable "transit_cidr" {
  description = "CIDR du réseau de transit (host = .1, OPNsense = .2)."
  type        = string
}

variable "host_mgmt" {
  description = "IP de l'hôte dans la zone mgmt (null pour ne pas en créer). address au format CIDR."
  type = object({
    vlan    = number
    address = string
  })
  default = null
}

variable "mtu" {
  description = "MTU du bridge des zones."
  type        = number
  default     = 1500
}
