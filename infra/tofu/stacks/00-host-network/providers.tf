locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Valeurs de site fournies par l'opérateur (secrets/site.sops.yaml, modèle : secrets/site.example.yaml).
data "sops_file" "site" {
  source_file = "${path.root}/../../../../secrets/site.sops.yaml"
}

data "sops_file" "proxmox" {
  source_file = "${path.root}/../../../../secrets/proxmox.sops.yaml"
}

locals {
  pve          = yamldecode(data.sops_file.proxmox.raw)
  site         = yamldecode(data.sops_file.site.raw)
  pve_endpoint = trimsuffix(local.site.proxmox_url, "/")
  pve_token    = local.pve.proxmox.api_token
  pve_insecure = tobool(local.pve.proxmox.insecure)
}

provider "proxmox" {
  endpoint  = local.pve_endpoint
  api_token = local.pve_token
  insecure  = local.pve_insecure
}
