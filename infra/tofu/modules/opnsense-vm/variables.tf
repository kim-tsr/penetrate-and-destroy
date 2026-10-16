variable "node_name" {
  description = "Nom du node Proxmox."
  type        = string
}

variable "vmid" {
  description = "VMID de la VM OPNsense."
  type        = number
}

variable "name" {
  description = "Nom de la VM (et hostname OPNsense)."
  type        = string
}

variable "domain" {
  description = "Domaine système d'OPNsense."
  type        = string
}

variable "cores" {
  description = "vCPU."
  type        = number
}

variable "memory_mb" {
  description = "RAM (Mo)."
  type        = number
}

variable "disk_gb" {
  description = "Taille du disque système (Go) ; l'image nano s'étend au premier boot."
  type        = number
}

variable "datastore_id" {
  description = "Datastore du disque de la VM (contrat : host.datastore_vm)."
  type        = string
}

variable "iso_datastore_id" {
  description = "Datastore (contenu iso) recevant l'image nano et l'ISO de config (ex : local)."
  type        = string
}

variable "image" {
  description = "Image nano OPNsense épinglée (URL .img.bz2, nom final .img, sha256 du .bz2)."
  type = object({
    version   = string
    url       = string
    file_name = string
    sha256    = string
  })
}

variable "wan" {
  description = <<-EOT
    WAN d'OPNsense (vtnet0).
    - routed_ip : bridge vmbr0, address_cidr = IP publique supplémentaire routée vers la VM (/32), mac_address = MAC dédiée si l'hébergeur l'exige (sinon null), gateway = passerelle de l'hôte (far_gateway = true).
    - nat : bridge vmbr1, mac_address = null, address_cidr = .2/30 du transit, gateway = .1 (far_gateway = false).
  EOT
  type = object({
    mode         = string
    bridge       = string
    mac_address  = optional(string)
    address_cidr = string
    gateway      = string
    far_gateway  = bool
  })

  validation {
    condition     = contains(["routed_ip", "nat"], var.wan.mode)
    error_message = "wan.mode doit valoir routed_ip ou nat."
  }
}

variable "lan_bridge" {
  description = "Bridge VLAN-aware des zones (trunk vtnet1)."
  type        = string
}

variable "zones" {
  description = "Zones du contrat (vlan, cidr, gw). La zone de plus petit VLAN devient l'interface lan (anti-lockout)."
  type = map(object({
    vlan = number
    cidr = string
    gw   = string
  }))
}

variable "webgui_zones" {
  description = "Zones où la GUI/API OPNsense écoute."
  type        = list(string)
  default     = ["mgmt"]
}

variable "ssh_zones" {
  description = "Zones où SSH écoute (admin uniquement depuis bastion et mgmt)."
  type        = list(string)
  default     = ["mgmt", "bastion"]
}

variable "root_password_hash" {
  description = "Hash bcrypt ($2y$) du mot de passe root (SOPS)."
  type        = string
  sensitive   = true
}

variable "admin_ssh_public_keys" {
  description = "Clés publiques SSH autorisées pour root."
  type        = list(string)
}

variable "api_key" {
  description = "Clé API OPNsense (utilisée par le provider tofu)."
  type        = string
  sensitive   = true
}

variable "api_secret_crypt" {
  description = "Secret API hashé crypt SHA-512 ($6$), tel que stocké par OPNsense."
  type        = string
  sensitive   = true
}

variable "opnsense_dir" {
  description = "Répertoire contenant config.xml.tmpl et les scripts (infra/opnsense)."
  type        = string
}

variable "build_dir" {
  description = "Répertoire de travail hors Git pour le rendu et l'ISO (ex : <repo>/.state/opnsense)."
  type        = string
}

variable "auto_import" {
  description = "Déclencher l'importer au premier boot via l'API Proxmox (sendkey)."
  type        = bool
  default     = true
}

variable "proxmox_endpoint" {
  description = "URL de l'API Proxmox (https://host:8006), pour import-config.sh."
  type        = string
}

variable "proxmox_api_token" {
  description = "Jeton API Proxmox, pour import-config.sh (passé en variable d'environnement)."
  type        = string
  sensitive   = true
}

variable "proxmox_insecure" {
  description = "Ignorer le certificat de l'API Proxmox."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags Proxmox."
  type        = list(string)
  default     = ["pad", "router", "opnsense"]
}
