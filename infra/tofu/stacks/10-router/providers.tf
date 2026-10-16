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

data "sops_file" "opnsense" {
  source_file = "${path.root}/../../../../secrets/opnsense.sops.yaml"
}

locals {
  pve          = yamldecode(data.sops_file.proxmox.raw)
  site         = yamldecode(data.sops_file.site.raw)
  opn          = yamldecode(data.sops_file.opnsense.raw)
  pve_endpoint = trimsuffix(local.site.proxmox_url, "/")
}

provider "proxmox" {
  endpoint  = local.pve_endpoint
  api_token = local.pve.proxmox.api_token
  insecure  = tobool(local.pve.proxmox.insecure)

  # SSH requis pour importer l'image nano (.img sur le stockage iso) via disk.file_id.
  # La clé privée est fournie par l'agent SSH local.
  ssh {
    agent    = true
    username = local.site.ssh_user
  }
}
