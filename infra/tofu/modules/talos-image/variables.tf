variable "node_name" {
  description = "Nom du node Proxmox."
  type        = string
}

variable "talos_version" {
  description = "Version de Talos (ex : v1.11.3)."
  type        = string
}

variable "extensions" {
  description = "Extensions officielles intégrées au schematic Image Factory."
  type        = list(string)
  default     = ["siderolabs/qemu-guest-agent"]
}

variable "vmid" {
  description = "VMID du template."
  type        = number
}

variable "name" {
  description = "Nom du template VM."
  type        = string
}

variable "datastore_id" {
  description = "Datastore du disque du template (contrat : host.datastore_vm)."
  type        = string
}

variable "import_datastore_id" {
  description = "Datastore (contenu import) recevant l'image téléchargée (ex : local)."
  type        = string
}

variable "image_checksum" {
  description = "SHA-256 optionnel de l'image qcow2 (l'Image Factory n'en publie pas)."
  type        = string
  default     = null
}

variable "bridge" {
  description = "Bridge de la NIC par défaut du template (CAPMOX la surcharge à chaque clone)."
  type        = string
}

variable "cores" {
  description = "vCPU par défaut du template."
  type        = number
  default     = 2
}

variable "memory_mb" {
  description = "RAM par défaut du template (Mo)."
  type        = number
  default     = 2048
}

variable "disk_gb" {
  description = "Taille du disque du template (Go) ; CAPMOX l'agrandit par MachineTemplate."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags Proxmox du template."
  type        = list(string)
  default     = ["pad", "talos", "template"]
}
