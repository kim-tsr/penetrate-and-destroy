# Flows : authentification, enrôlement des joueurs (self-registration) et invitation staff.

locals {
  email_from = var.email_from != "" ? var.email_from : "noreply@${local.c.domain}"
}

# ---- Flows par défaut d'Authentik réutilisés ---------------------------------------------------

data "authentik_flow" "provider_invalidation" {
  slug = "default-provider-invalidation-flow"
}

data "authentik_flow" "invalidation" {
  slug = "default-invalidation-flow"
}

# ---- Authentification (identifiant + mot de passe, lien d'inscription) -----------------------

resource "authentik_stage_password" "login" {
  name     = "pad-authentication-password"
  backends = ["authentik.core.auth.InbuiltBackend", "authentik.core.auth.TokenBackend"]
  # Anti-brute-force : le flow est annulé (et relancé) après N mots de passe faux ; chaque échec alimente en plus
  # la réputation IP/identifiant (authentik_policy_reputation.login, liée aux étapes du flow).
  failed_attempts_before_cancel = var.login_max_failed_attempts
}

resource "authentik_stage_identification" "login" {
  name               = "pad-authentication-identification"
  user_fields        = ["username", "email"]
  password_stage     = authentik_stage_password.login.id
  enrollment_flow    = authentik_flow.player_enrollment.uuid
  show_source_labels = false
}

resource "authentik_stage_user_login" "session" {
  name             = "pad-user-login"
  session_duration = "hours=12" # aligné sur SESSION_MAX_AGE du front (12 h)
}

resource "authentik_flow" "authentication" {
  name        = "pad-authentication"
  title       = "Connexion à PenetrateAndDestroy"
  slug        = "pad-authentication"
  designation = "authentication"
}

resource "authentik_flow_stage_binding" "authentication_identification" {
  target = authentik_flow.authentication.uuid
  stage  = authentik_stage_identification.login.id
  order  = 10
}

resource "authentik_flow_stage_binding" "authentication_login" {
  target = authentik_flow.authentication.uuid
  stage  = authentik_stage_user_login.session.id
  order  = 100

  # L'utilisateur n'est connu qu'une fois identifié : les policies de ce binding (réputation par identifiant)
  # sont donc évaluées à la présentation de l'étape, pas au plan du flow.
  evaluate_on_plan     = false
  re_evaluate_policies = true
}

# ---- Anti-brute-force : réputation IP + identifiant ------------------------------------------------
# Authentik décrémente le score de l'IP et de l'identifiant à chaque échec de connexion (événement login_failed).
# La policy « réussit » quand le score est <= threshold (négatif) ; le binding est négé : l'accès est refusé
# tant que la réputation est dégradée. Le score est borné par reputation_lower_limit (settings.tf) et se
# résorbe avec l'expiration des entrées de réputation d'Authentik (de l'ordre de 24 h, à vérifier à l'usage).

resource "authentik_policy_reputation" "login" {
  name           = "pad-login-reputation"
  check_ip       = true
  check_username = var.login_reputation_check_username # false par défaut : évite qu'un joueur verrouille un compte staff
  threshold      = -var.login_reputation_threshold
}

# Sur l'identification : bloque une IP qui martèle le formulaire (identifiant encore inconnu à ce stade).
resource "authentik_policy_binding" "login_reputation_identification" {
  target = authentik_flow_stage_binding.authentication_identification.id
  policy = authentik_policy_reputation.login.id
  negate = true
  order  = 0
}

# Sur la création de session : bloque aussi l'identifiant ciblé depuis plusieurs IP (credential stuffing distribué),
# même avec le bon mot de passe tant que le blocage court.
resource "authentik_policy_binding" "login_reputation_login" {
  target = authentik_flow_stage_binding.authentication_login.id
  policy = authentik_policy_reputation.login.id
  negate = true
  order  = 0
}

# ---- MFA obligatoire (TOTP / WebAuthn) pour les comptes à privilèges ----------------------------
# Groupes concernés : local.mfa_groups (ctf-managers, ctf-admins, infra-admins). Les joueurs ne sont pas forcés,
# mais valident leur facteur s'ils en ont configuré un.
# La MFA est exigée à DEUX endroits :
#  1. flow d'authentification pad-authentication (session Authentik) ;
#  2. flow d'autorisation pad-provider-authorization, utilisé par TOUS les providers OIDC/proxy : un compte staff
#     qui passerait par un autre flow d'authentification (ex. default-authentication-flow, toujours présent dans
#     Authentik) ne peut de toute façon pas obtenir de jeton pour ArgoCD, Warpgate, Grafana, Proxmox, CTFd ni le front
#     sans présenter un second facteur.

resource "authentik_policy_expression" "is_staff" {
  name       = "pad-is-staff"
  expression = <<-PY
    # Vrai pour tout compte d'un groupe à privilèges (MFA obligatoire).
    user = request.user
    if not getattr(user, "is_authenticated", False):
        return False
    return user.ak_groups.filter(name__in=${jsonencode(local.mfa_groups)}).exists()
  PY
}

resource "authentik_stage_authenticator_totp" "setup" {
  name          = "pad-mfa-totp-setup"
  friendly_name = "Application d'authentification (TOTP)"
  digits        = "6"
}

resource "authentik_stage_authenticator_webauthn" "setup" {
  name                     = "pad-mfa-webauthn-setup"
  friendly_name            = "Clé de sécurité / passkey (WebAuthn)"
  user_verification        = "preferred"
  resident_key_requirement = "preferred"
}

# Staff : la validation est obligatoire ; sans facteur enregistré, l'utilisateur est forcé d'en enrôler un
# (TOTP ou WebAuthn) avant de continuer (not_configured_action = configure, jamais skip).
resource "authentik_stage_authenticator_validate" "staff" {
  name                  = "pad-mfa-validate-staff"
  device_classes        = ["totp", "webauthn"]
  not_configured_action = "configure"
  configuration_stages = [
    authentik_stage_authenticator_totp.setup.id,
    authentik_stage_authenticator_webauthn.setup.id,
  ]
  webauthn_user_verification = "preferred"
  # Un facteur validé il y a moins longtemps n'est pas redemandé (évite le double prompt connexion + application).
  last_auth_threshold = "minutes=${var.staff_mfa_reauth_minutes}"
}

# Joueurs : facteur validé seulement s'ils en ont configuré un.
resource "authentik_stage_authenticator_validate" "optional" {
  name                  = "pad-mfa-validate-optional"
  device_classes        = ["totp", "webauthn"]
  not_configured_action = "skip"
}

resource "authentik_flow_stage_binding" "authentication_mfa_staff" {
  target = authentik_flow.authentication.uuid
  stage  = authentik_stage_authenticator_validate.staff.id
  order  = 30

  # Utilisateur inconnu au plan du flow : policy évaluée quand l'étape est présentée.
  evaluate_on_plan     = false
  re_evaluate_policies = true
}

resource "authentik_policy_binding" "authentication_mfa_staff" {
  target = authentik_flow_stage_binding.authentication_mfa_staff.id
  policy = authentik_policy_expression.is_staff.id
  order  = 0
}

resource "authentik_flow_stage_binding" "authentication_mfa_optional" {
  target = authentik_flow.authentication.uuid
  stage  = authentik_stage_authenticator_validate.optional.id
  order  = 40

  evaluate_on_plan     = false
  re_evaluate_policies = true
}

resource "authentik_policy_binding" "authentication_mfa_optional" {
  target = authentik_flow_stage_binding.authentication_mfa_optional.id
  policy = authentik_policy_expression.is_staff.id
  negate = true
  order  = 0
}

# Flow d'autorisation commun aux providers : consentement implicite (comme le flow par défaut) + MFA staff.
resource "authentik_flow" "authorization" {
  name           = "pad-provider-authorization"
  title          = "Autorisation de l'application"
  slug           = "pad-provider-authorization"
  designation    = "authorization"
  authentication = "require_authenticated"
}

resource "authentik_flow_stage_binding" "authorization_mfa_staff" {
  target = authentik_flow.authorization.uuid
  stage  = authentik_stage_authenticator_validate.staff.id
  order  = 10
}

resource "authentik_policy_binding" "authorization_mfa_staff" {
  target = authentik_flow_stage_binding.authorization_mfa_staff.id
  policy = authentik_policy_expression.is_staff.id
  order  = 0
}

# ---- Prompt commun (username, email, mot de passe) ---------------------------------------------

resource "authentik_policy_password" "strength" {
  name           = "pad-password-strength"
  password_field = "password"
  error_message  = "Mot de passe trop faible (12 caractères minimum, ni trop courant ni compromis)."
  length_min     = 12
  check_zxcvbn   = true
  # Pas de HIBP : le LXC identity n'a pas de sortie vers Internet garantie.
  check_have_i_been_pwned = false
  zxcvbn_score_threshold  = 2
}

resource "authentik_stage_prompt_field" "username" {
  name      = "pad-enrollment-username"
  field_key = "username"
  label     = "Pseudo"
  type      = "username"
  required  = true
  order     = 10
}

resource "authentik_stage_prompt_field" "email" {
  name      = "pad-enrollment-email"
  field_key = "email"
  label     = "Adresse e-mail"
  type      = "email"
  required  = true
  order     = 20
}

resource "authentik_stage_prompt_field" "password" {
  name      = "pad-enrollment-password"
  field_key = "password"
  label     = "Mot de passe"
  type      = "password"
  required  = true
  order     = 30
}

resource "authentik_stage_prompt_field" "password_repeat" {
  name      = "pad-enrollment-password-repeat"
  field_key = "password_repeat"
  label     = "Confirmation du mot de passe"
  type      = "password"
  required  = true
  order     = 40
}

resource "authentik_stage_prompt" "enrollment" {
  name = "pad-enrollment-prompt"
  fields = [
    authentik_stage_prompt_field.username.id,
    authentik_stage_prompt_field.email.id,
    authentik_stage_prompt_field.password.id,
    authentik_stage_prompt_field.password_repeat.id,
  ]
  validation_policies = [authentik_policy_password.strength.id]
}

# ---- Flow d'enrôlement des joueurs (self-registration) ----------------------------------------
# captcha (activé par défaut) -> prompt -> création INACTIVE dans ctf-players -> e-mail de vérification
# (active le compte au clic) -> session.

resource "authentik_flow" "player_enrollment" {
  name        = "pad-player-enrollment"
  title       = "Inscription joueur"
  slug        = "pad-player-enrollment"
  designation = "enrollment"
}

resource "authentik_stage_captcha" "enrollment" {
  count = var.captcha_enabled ? 1 : 0

  name        = "pad-enrollment-captcha"
  public_key  = local.captcha_public_key
  private_key = local.captcha_private_key
  js_url      = var.captcha_js_url
  api_url     = var.captcha_api_url
  interactive = false

  lifecycle {
    precondition {
      condition     = local.captcha_public_key != "" && local.captcha_private_key != ""
      error_message = "captcha_enabled (défaut) exige captcha_public_key et captcha_private_key (variables ou secrets/authentik-tofu.sops.yaml), ou captcha_enabled=false explicite."
    }
  }
}

resource "authentik_stage_user_write" "player" {
  name                     = "pad-player-user-write"
  user_creation_mode       = "always_create"
  user_type                = "internal"
  create_users_as_inactive = true
  create_users_group       = authentik_group.contract[local.g_players].id
  user_path_template       = "users/players"
}

resource "authentik_stage_email" "verify" {
  name                     = "pad-email-verification"
  use_global_settings      = true # SMTP posé par le rôle ansible authentik (AUTHENTIK_EMAIL__*)
  from_address             = local.email_from
  subject                  = "Confirme ton compte PenetrateAndDestroy"
  template                 = "email/account_confirmation.html"
  token_expiry             = "minutes=${var.email_token_expiry_minutes}"
  activate_user_on_success = true
}

resource "authentik_flow_stage_binding" "player_captcha" {
  count = var.captcha_enabled ? 1 : 0

  target = authentik_flow.player_enrollment.uuid
  stage  = authentik_stage_captcha.enrollment[0].id
  order  = 5
}

resource "authentik_flow_stage_binding" "player_prompt" {
  target = authentik_flow.player_enrollment.uuid
  stage  = authentik_stage_prompt.enrollment.id
  order  = 10
}

resource "authentik_flow_stage_binding" "player_write" {
  target = authentik_flow.player_enrollment.uuid
  stage  = authentik_stage_user_write.player.id
  order  = 20
}

resource "authentik_flow_stage_binding" "player_email" {
  target = authentik_flow.player_enrollment.uuid
  stage  = authentik_stage_email.verify.id
  order  = 30
}

resource "authentik_flow_stage_binding" "player_login" {
  target = authentik_flow.player_enrollment.uuid
  stage  = authentik_stage_user_login.session.id
  order  = 40
}

# ---- Flow d'invitation staff -------------------------------------------------------------------
# Accessible uniquement avec un lien d'invitation créé par un admin (continue_flow_without_invitation = false).
# Les invitations elles-mêmes sont des objets éphémères : créées à la demande dans l'UI (Directory > Invitations).

resource "authentik_flow" "staff_invitation" {
  name        = "pad-staff-invitation"
  title       = "Invitation staff"
  slug        = "pad-staff-invitation"
  designation = "enrollment"
}

resource "authentik_stage_invitation" "staff" {
  name                             = "pad-staff-invitation"
  continue_flow_without_invitation = false
}

resource "authentik_stage_user_write" "staff" {
  name                     = "pad-staff-user-write"
  user_creation_mode       = "always_create"
  user_type                = "internal"
  create_users_as_inactive = false # l'invitation fait foi, pas de vérification e-mail
  create_users_group       = authentik_group.contract[var.staff_invitation_group].id
  user_path_template       = "users/staff"
}

resource "authentik_flow_stage_binding" "staff_invitation" {
  target = authentik_flow.staff_invitation.uuid
  stage  = authentik_stage_invitation.staff.id
  order  = 10
}

resource "authentik_flow_stage_binding" "staff_prompt" {
  target = authentik_flow.staff_invitation.uuid
  stage  = authentik_stage_prompt.enrollment.id
  order  = 20
}

resource "authentik_flow_stage_binding" "staff_write" {
  target = authentik_flow.staff_invitation.uuid
  stage  = authentik_stage_user_write.staff.id
  order  = 30
}

resource "authentik_flow_stage_binding" "staff_login" {
  target = authentik_flow.staff_invitation.uuid
  stage  = authentik_stage_user_login.session.id
  order  = 40
}
