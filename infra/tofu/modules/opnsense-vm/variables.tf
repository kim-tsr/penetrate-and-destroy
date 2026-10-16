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

variable "port_forwards" {
  description = <<-EOT
    Redirections de ports WAN (DNAT) écrites dans config.xml (contrat wan.public_ports), destination = adresse WAN.
    proto : tcp ou udp ; port : "443" ou plage "a-b" (même plage côté cible) ; target : IP interne ; name : service cible.
    Le filtrage (règles pass M1) reste au stack 60-opnsense-rules.
  EOT
  type = list(object({
    proto  = string
    port   = string
    target = string
    name   = string
  }))
  default = []

  validation {
    condition = alltrue([
      for pf in var.port_forwards :
      contains(["tcp", "udp"], lower(pf.proto))
      && can(regex("^[0-9]{1,5}(-[0-9]{1,5})?$", pf.port))
      && can(cidrhost("${pf.target}/32", 0))
      && can(regex("^[A-Za-z0-9_.-]+$", pf.name))
    ])
    error_message = "port_forwards : proto tcp|udp, port \"N\" ou \"A-B\", target = IPv4, name alphanumérique (rendu tel quel dans config.xml)."
  }
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
  description = "Déclencher l'importer au premier boot par la console série de la VM (import-config.sh, SSH vers l'hôte)."
  type        = bool
  default     = true
}

variable "ssh_host" {
  description = "Adresse SSH de l'hôte Proxmox (ssh_host de secrets/site.sops.yaml), pour import-config.sh."
  type        = string
}

variable "ssh_user" {
  description = "Utilisateur SSH (sudo) de l'hôte Proxmox, pour import-config.sh ; clé fournie par l'agent SSH."
  type        = string
}

variable "tags" {
  description = "Tags Proxmox."
  type        = list(string)
  default     = ["pad", "router", "opnsense"]
}
