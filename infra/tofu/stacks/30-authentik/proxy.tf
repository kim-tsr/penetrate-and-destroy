# Forward-auth (mode domaine) pour les UIs internes sans OIDC : VictoriaMetrics, Alertmanager, Hubble.
# Un seul provider proxy « forward_domain » couvre tous les sous-domaines de `domain` : le cookie de session
# est posé sur le domaine racine et Traefik (edge) appelle l'outpost via un middleware forwardAuth.
# Accès réservé à infra-admins.
#
# TODO (hors périmètre de ce stack) :
#  - ajouter les hostnames des 3 UIs au contrat (hostnames.*) et les router côté edge/gitops avec le middleware
#    forwardAuth vers https://<auth>.<domain>/outpost.goauthentik.io/auth/traefik ;
#  - l'outpost embarqué doit connaître authentik_host = https://<auth>.<domain> (Outposts > Embedded Outpost >
#    configuration), sinon les redirections de login partent vers l'hôte interne.

locals {
  internal_ui_fqdns = { for k, v in var.internal_ui_hosts : k => "${v}.${local.c.domain}" }
}

resource "authentik_provider_proxy" "internal" {
  name               = "pad-internal-ui"
  mode               = "forward_domain"
  external_host      = local.auth_url
  cookie_domain      = local.c.domain
  authorization_flow = authentik_flow.authorization.uuid
  invalidation_flow  = data.authentik_flow.provider_invalidation.id
}

resource "authentik_application" "internal" {
  name               = "UIs internes (forward-auth)"
  slug               = "pad-internal-ui"
  protocol_provider  = tonumber(authentik_provider_proxy.internal.id)
  meta_publisher     = "PenetrateAndDestroy"
  meta_description   = join(", ", values(local.internal_ui_fqdns))
  policy_engine_mode = "any"
}

resource "authentik_policy_binding" "internal" {
  target = authentik_application.internal.uuid
  group  = authentik_group.contract["infra-admins"].id
  order  = 0
}

# Outpost embarqué (créé par Authentik au premier démarrage) : on y rattache le provider.
data "authentik_outpost" "embedded" {
  name = "authentik Embedded Outpost"
}

resource "authentik_outpost_provider_attachment" "internal" {
  outpost           = data.authentik_outpost.embedded.id
  protocol_provider = tonumber(authentik_provider_proxy.internal.id)
}
