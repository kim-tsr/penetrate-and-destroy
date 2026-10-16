locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Jeton d'un utilisateur de service NetBird (rôle admin), créé à la main après le 1er déploiement
# (cf. README). Modèle : secrets/netbird-tofu.example.yaml.
data "sops_file" "netbird" {
  source_file = "${path.root}/../../../../secrets/netbird-tofu.sops.yaml"
}

# Secret du client OIDC pad-netbird : lu uniquement si var.manage_identity_provider.
data "sops_file" "netbird_server" {
  count = var.manage_identity_provider ? 1 : 0

  source_file = "${path.root}/../../../../secrets/netbird.sops.yaml"
}

locals {
  nb = yamldecode(data.sops_file.netbird.raw)

  # URL de l'API management : https://<vpn>.<domain> (le provider ajoute /api lui-même ; contrat netbird.api_url sans le suffixe).
  vpn_host = "${local.c.hostnames.vpn}.${local.c.domain}"
  vpn_url  = "https://${local.vpn_host}"

  auth_url = "https://${local.c.hostnames.auth}.${local.c.domain}"
}

provider "netbird" {
  management_url = local.vpn_url
  token          = local.nb.api_token
}
