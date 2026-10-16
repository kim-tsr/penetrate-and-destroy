# Réglages système d'Authentik (singleton). Géré ici pour ne pas dépendre de l'état par défaut de l'instance.

resource "authentik_system_settings" "this" {
  # L'e-mail sert de clé de liaison de compte côté CTFd (plugin sso_bridge) : un utilisateur ne doit pas pouvoir
  # le modifier lui-même pour usurper l'adresse d'un autre compte (ex. compte de secours). Idem pour le pseudo.
  default_user_change_email    = false
  default_user_change_username = false
  default_user_change_name     = false

  # Bornes du score de réputation : la borne basse doit être <= -login_reputation_threshold (flows.tf),
  # sinon le seuil ne serait jamais atteint.
  reputation_lower_limit = -var.login_reputation_threshold
  reputation_upper_limit = 5
}
