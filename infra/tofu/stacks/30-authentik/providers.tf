locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Valeurs de site fournies par l'opérateur (secrets/site.sops.yaml, modèle : secrets/site.example.yaml).
data "sops_file" "site" {
  source_file = "${path.root}/../../../../secrets/site.sops.yaml"
}

data "sops_file" "authentik" {
  source_file = "${path.root}/../../../../secrets/authentik-tofu.sops.yaml"
}

locals {
  ak   = yamldecode(data.sops_file.authentik.raw)
  site = yamldecode(data.sops_file.site.raw)

  proxmox_url = var.proxmox_url != "" ? trimsuffix(var.proxmox_url, "/") : trimsuffix(local.site.proxmox_url, "/")

  # URL publique d'Authentik : https://<auth>.<domain>
  auth_host = "${local.c.hostnames.auth}.${local.c.domain}"
  auth_url  = "https://${local.auth_host}"
}

provider "authentik" {
  url   = local.auth_url
  token = local.ak.api_token
}
