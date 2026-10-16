# Brand PenetrateAndDestroy rattaché au FQDN d'Authentik. Le CSS est lu depuis le blueprint ansible
# (rôle authentik) pour garder une seule source de vérité de la charte graphite/ambre.
# Le blueprint pose la brand par défaut `authentik-default` ; celle-ci est plus spécifique (domaine exact)
# et ajoute les flows pad-*.

locals {
  brand_blueprint = yamldecode(file("${path.root}/../../../ansible/roles/authentik/files/blueprints/pad-branding.yaml"))
  brand_css       = local.brand_blueprint.entries[0].attrs.branding_custom_css
}

resource "authentik_brand" "pad" {
  domain              = local.auth_host
  default             = false
  branding_title      = "PenetrateAndDestroy"
  branding_custom_css = local.brand_css

  flow_authentication = authentik_flow.authentication.uuid
  flow_invalidation   = data.authentik_flow.invalidation.id
}
