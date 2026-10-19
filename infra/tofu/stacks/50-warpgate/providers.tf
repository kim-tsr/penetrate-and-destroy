locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Jeton d'API Warpgate (Warpgate >= 0.29 : profil de l'utilisateur admin > API tokens (https://bastion.<domaine>:8888/@warpgate#/profile/api-tokens)), créé après le 1er déploiement ; il porte les droits de admin.
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

  # URL de l'API admin : par défaut l'accès direct https://<services.warpgate.ip>:<ports.warpgate.https>, celui du poste
  # opérateur en phase 11 (route VPN vers les zones, règle OPNsense m0-host-warpgate) : il n'est pas encore sur NetBird
  # et le nom du bastion n'est résolu que par le DNS NetBird. Warpgate y sert un certificat auto-signé (voir
  # var.insecure_skip_verify). L'API s'authentifie par jeton : la liaison de session à external_host ne s'applique pas.
  direct_url = "https://${local.c.services.warpgate.ip}:${local.c.ports.warpgate.https}"
  api_url    = var.warpgate_api_url != "" ? var.warpgate_api_url : local.direct_url
}

provider "warpgate" {
  host                 = local.api_url
  token                = local.wg.api_token
  insecure_skip_verify = var.insecure_skip_verify
}
