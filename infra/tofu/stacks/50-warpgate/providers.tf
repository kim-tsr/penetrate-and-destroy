locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Jeton d'API Warpgate (UI admin > Config > Tokens), créé après le 1er déploiement.
# Modèle : secrets/warpgate-tofu.example.yaml.
# Valeurs de site fournies par l'opérateur (secrets/site.sops.yaml, modèle : secrets/site.example.yaml).
data "sops_file" "site" {
  source_file = "${path.root}/../../../../secrets/site.sops.yaml"
}

data "sops_file" "warpgate" {
  source_file = "${path.root}/../../../../secrets/warpgate-tofu.sops.yaml"
}

locals {
  wg   = yamldecode(data.sops_file.warpgate.raw)
  site = yamldecode(data.sops_file.site.raw)

  # URL de l'API admin : par défaut l'URL publique interne https://<bastion>.<domain> (via NetBird staff + edge).
  # Alternative depuis un poste de la zone MGMT/BASTION : https://<services.warpgate.ip>:<ports.warpgate.https>
  # (certificat auto-signé : var.insecure_skip_verify = true).
  bastion_url = "https://${local.c.hostnames.bastion}.${local.c.domain}"
  api_url     = var.warpgate_api_url != "" ? var.warpgate_api_url : local.bastion_url
}

provider "warpgate" {
  host                 = local.api_url
  token                = local.wg.api_token
  insecure_skip_verify = var.insecure_skip_verify
}
