locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

data "sops_file" "opnsense" {
  source_file = "${path.root}/../../../../secrets/opnsense.sops.yaml"
}

locals {
  opn = yamldecode(data.sops_file.opnsense.raw)
}

# API OPNsense joignable depuis la zone mgmt (anti-lockout sur lan).
# Depuis le poste opérateur : tunnel SSH via l'hôte Proxmox, ex. `ssh -L 8443:10.20.10.1:443 <utilisateur>@<hôte>`
# puis -var opnsense_uri=https://127.0.0.1:8443 (voir infra/opnsense/README.md).
provider "opnsense" {
  uri            = coalesce(var.opnsense_uri, "https://${local.c.zones.mgmt.gw}")
  api_key        = local.opn.api_key
  api_secret     = local.opn.api_secret
  allow_insecure = var.opnsense_allow_insecure
}
