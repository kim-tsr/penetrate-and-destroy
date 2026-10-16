# Flows : authentification, enrôlement des joueurs (self-registration) et invitation staff.

locals {
  email_from = var.email_from != "" ? var.email_from : "noreply@${local.c.domain}"
}

# ---- Flows par défaut d'Authentik réutilisés ---------------------------------------------------

data "authentik_flow" "authorization_implicit" {
  slug = "default-provider-authorization-implicit-consent"
}

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
# captcha (optionnel) -> prompt -> création INACTIVE dans ctf-players -> e-mail de vérification
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
  public_key  = var.captcha_public_key
  private_key = var.captcha_private_key
  js_url      = var.captcha_js_url
  api_url     = var.captcha_api_url
  interactive = false

  lifecycle {
    precondition {
      condition     = var.captcha_public_key != "" && var.captcha_private_key != ""
      error_message = "captcha_enabled exige captcha_public_key et captcha_private_key."
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
