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

# API d'administration : par défaut le chemin INTERNE (LXC authentik, 443 publié), joint par la route du poste vers les
# zones (traduite vers l'IP mgmt de l'hôte, flux M0). L'URL publique passe par l'edge, qui réserve l'API d'administration
# aux CIDR internes (403 depuis Internet). Certificat auto-signé d'Authentik en interne : vérification TLS désactivée
# sur ce seul chemin. Surcharge : -var authentik_api_url=https://<auth>.<domaine> (depuis la zone bastion/mgmt).
locals {
  authentik_api_internal = "https://${local.c.services.authentik.ip}:${local.c.ports.authentik.https}"
  authentik_api_url      = var.authentik_api_url != "" ? trimsuffix(var.authentik_api_url, "/") : local.authentik_api_internal
}

provider "authentik" {
  url      = local.authentik_api_url
  token    = local.ak.api_token
  insecure = local.authentik_api_url == local.authentik_api_internal
}
