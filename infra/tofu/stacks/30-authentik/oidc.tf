# Un provider OAuth2/OIDC + une application par client de `identity.oidc_clients`.
# Issuer de chaque client : https://<auth>.<domain>/application/o/<slug>/ avec slug = client_id du contrat.

locals {
  host = { for k, v in local.c.hostnames : k => "${v}.${local.c.domain}" }

  oidc_clients = {
    frontend = {
      name = "Front CTF"
      # Source : apps/frontend/src/auth.ts (Auth.js v5, provider `authentik`, basePath /api/auth par défaut)
      # -> callback /api/auth/callback/authentik.
      redirect_uris = ["https://${local.host.front}/api/auth/callback/authentik"]
      launch_url    = "https://${local.host.front}/"
      groups        = local.player_groups
      public        = false
    }
    netbird = {
      name = "NetBird"
      # Source : infra/ansible/roles/netbird-server/README.md (connecteur OIDC ajouté à l'IdP embarqué/Dex).
      # Public (PKCE, sans secret) uniquement si var.netbird_dashboard_public.
      redirect_uris = ["https://${local.host.vpn}/oauth2/callback"]
      launch_url    = "https://${local.host.vpn}/"
      groups        = local.player_groups
      public        = var.netbird_dashboard_public
    }
    warpgate = {
      name = "Warpgate (bastion)"
      # Source : infra/ansible/roles/warpgate/README.md.
      # TODO : "à confirmer dans l'UI Warpgate, page de config SSO" (chemin /@warpgate/api/sso/return non vérifié en 0.29.2).
      redirect_uris = ["https://${local.host.bastion}/@warpgate/api/sso/return"]
      launch_url    = "https://${local.host.bastion}/"
      groups        = local.infra_groups
      public        = false
    }
    grafana = {
      name = "Grafana"
      # Source : doc Grafana generic OAuth (root_url + /login/generic_oauth) ;
      # compose.yml.j2 du rôle monitoring-stack (GF_AUTH_GENERIC_OAUTH_*), root_url = https://<grafana>.<domain>.
      redirect_uris = ["https://${local.host.grafana}/login/generic_oauth"]
      launch_url    = "https://${local.host.grafana}/"
      groups        = local.infra_groups
      public        = false
    }
    argocd = {
      name = "ArgoCD"
      # Source : doc ArgoCD (url + /auth/callback) ; gitops/platform/argocd/values.yaml (configs.cm.url).
      # Le 2e URI sert `argocd login --sso` (CLI, port 8085 par défaut).
      # NB : values.yaml pointe l'issuer sur /application/o/argocd/ alors que le slug ici est pad-argocd (contrat) : à aligner côté gitops.
      redirect_uris = [
        "https://${local.host.argocd}/auth/callback",
        "http://localhost:8085/auth/callback",
      ]
      launch_url = "https://${local.host.argocd}/"
      groups     = local.infra_groups
      public     = false
    }
    proxmox = {
      name = "Proxmox VE"
      # Source : doc Proxmox (realm OpenID : l'URI de redirection est l'origine de l'UI, avec ou sans « / » final).
      # var.proxmox_url vide : proxmox_url de secrets/site.sops.yaml.
      redirect_uris = [local.proxmox_url, "${local.proxmox_url}/"]
      launch_url    = local.proxmox_url
      groups        = local.infra_groups
      public        = false
    }
    ctfd = {
      name = "CTFd (admin)"
      # TODO : CTFd est headless, l'OIDC est porté par le front et le plugin sso-bridge (apps/ctfd/API.md) ;
      # aucun callback OIDC CTFd n'existe (les routes d'auth natives répondent 404). URI réservée, non fonctionnelle.
      redirect_uris = concat(["https://${local.host.ctfd_admin}/oidc/callback"], var.ctfd_extra_redirect_uris)
      launch_url    = "https://${local.host.ctfd_admin}/"
      groups        = local.event_admin_groups
      public        = false
    }
  }
}

# ---- Scopes -------------------------------------------------------------------------------------

data "authentik_property_mapping_provider_scope" "default" {
  managed_list = [
    "goauthentik.io/providers/oauth2/scope-openid",
    "goauthentik.io/providers/oauth2/scope-email",
    "goauthentik.io/providers/oauth2/scope-profile",
  ]
}

# Claim `groups` = noms des groupes de l'utilisateur.
resource "authentik_property_mapping_provider_scope" "groups" {
  name        = "pad-scope-groups"
  scope_name  = "groups"
  description = "Groupes de l'utilisateur"
  expression  = "return {\"groups\": [group.name for group in request.user.ak_groups.all()]}"
}

data "authentik_certificate_key_pair" "signing" {
  name = "authentik Self-signed Certificate"
}

# ---- Secrets clients ----------------------------------------------------------------------------

resource "random_password" "client_secret" {
  for_each = { for k, v in local.oidc_clients : k => v if !v.public }

  length  = 64
  special = false
}

# ---- Providers + applications -------------------------------------------------------------------

resource "authentik_provider_oauth2" "client" {
  for_each = local.oidc_clients

  name               = "pad-${each.key}"
  client_id          = local.c.identity.oidc_clients[each.key]
  client_type        = each.value.public ? "public" : "confidential"
  client_secret      = each.value.public ? null : random_password.client_secret[each.key].result
  authorization_flow = data.authentik_flow.authorization_implicit.id
  invalidation_flow  = data.authentik_flow.provider_invalidation.id
  signing_key        = data.authentik_certificate_key_pair.signing.id
  issuer_mode        = "per_provider"

  allowed_redirect_uris = [
    for u in each.value.redirect_uris : { matching_mode = "strict", url = u }
  ]

  property_mappings = concat(
    data.authentik_property_mapping_provider_scope.default.ids,
    [authentik_property_mapping_provider_scope.groups.id],
  )
}

resource "authentik_application" "client" {
  for_each = local.oidc_clients

  name               = each.value.name
  slug               = local.c.identity.oidc_clients[each.key]
  protocol_provider  = tonumber(authentik_provider_oauth2.client[each.key].id)
  meta_launch_url    = each.value.launch_url
  meta_publisher     = "PenetrateAndDestroy"
  policy_engine_mode = "any"
}

# Apps infra : infra-admins seul ; CTFd admin : ctf-admins + infra-admins ; front et NetBird : tous les groupes du contrat (joueurs inclus).
resource "authentik_policy_binding" "client" {
  for_each = merge([
    for k, v in local.oidc_clients : {
      for g in v.groups : "${k}/${g}" => { app = k, group = g }
    }
  ]...)

  target = authentik_application.client[each.value.app].uuid
  group  = authentik_group.contract[each.value.group].id
  order  = index(local.c.identity.groups, each.value.group)
}
