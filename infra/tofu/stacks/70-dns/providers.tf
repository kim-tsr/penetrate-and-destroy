locals {
  c = yamldecode(file("${path.root}/../../../contracts.yaml"))
}

# Valeurs de site fournies par l'opérateur (secrets/site.sops.yaml, modèle : secrets/site.example.yaml).
data "sops_file" "site" {
  source_file = "${path.root}/../../../../secrets/site.sops.yaml"
}

data "sops_file" "ovh" {
  source_file = "${path.root}/../../../../secrets/ovh.sops.yaml"
}

locals {
  ovh  = yamldecode(data.sops_file.ovh.raw)
  site = yamldecode(data.sops_file.site.raw)
}

provider "ovh" {
  endpoint           = local.ovh.endpoint
  application_key    = local.ovh.application_key
  application_secret = local.ovh.application_secret
  consumer_key       = local.ovh.consumer_key
}
