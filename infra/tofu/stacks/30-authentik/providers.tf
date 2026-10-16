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

  # Clés captcha : variable tofu prioritaire, sinon secrets/authentik-tofu.sops.yaml (captcha_public_key / captcha_private_key).
  captcha_public_key  = var.captcha_public_key != "" ? var.captcha_public_key : try(local.ak.captcha_public_key, "")
  captcha_private_key = var.captcha_private_key != "" ? var.captcha_private_key : try(local.ak.captcha_private_key, "")

  # URL publique d'Authentik : https://<auth>.<domain>
  auth_host = "${local.c.hostnames.auth}.${local.c.domain}"
  auth_url  = "https://${local.auth_host}"
}

provider "authentik" {
  url   = local.auth_url
  token = local.ak.api_token
}
