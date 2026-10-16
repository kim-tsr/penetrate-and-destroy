variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "captcha_enabled" {
  description = "Active le captcha (Turnstile/hCaptcha/reCAPTCHA) dans le flow d'inscription des joueurs."
  type        = bool
  default     = false
}

variable "captcha_js_url" {
  description = "URL du script captcha (défaut : Cloudflare Turnstile)."
  type        = string
  default     = "https://challenges.cloudflare.com/turnstile/v0/api.js"
}

variable "captcha_api_url" {
  description = "URL de vérification du captcha côté serveur (défaut : Cloudflare Turnstile)."
  type        = string
  default     = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
}

variable "captcha_public_key" {
  description = "Clé publique (site key) du captcha. Requise si captcha_enabled."
  type        = string
  default     = ""
}

variable "captcha_private_key" {
  description = "Clé privée (secret key) du captcha. Requise si captcha_enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "access_token_validity" {
  description = "Durée de vie des access tokens OIDC (format Authentik : hours=1;minutes=2)."
  type        = string
  default     = "minutes=10"
}

variable "refresh_token_validity" {
  description = "Durée de vie des refresh tokens OIDC (scope offline_access). Doit rester >= 4 h : le front revalide les groupes via le refresh token ; 12 h = durée de session du front."
  type        = string
  default     = "hours=12"

  validation {
    condition     = can(regex("^(hours=([4-9]|[1-9][0-9]+)|days=[1-9][0-9]*)$", var.refresh_token_validity))
    error_message = "refresh_token_validity doit valoir au moins 4 heures (ex. hours=12 ou days=1)."
  }
}

variable "login_max_failed_attempts" {
  description = "Mots de passe faux avant annulation du flow de connexion."
  type        = number
  default     = 5
}

variable "login_reputation_threshold" {
  description = "Nombre d'échecs de connexion cumulés (par IP) au-delà duquel la connexion est refusée. Élevé par défaut : plusieurs joueurs peuvent partager une IP (NAT, salle)."
  type        = number
  default     = 20
}

variable "login_reputation_check_username" {
  description = "Verrouille aussi par identifiant. Désactivé par défaut : un joueur pourrait sinon verrouiller un compte staff en échouant exprès (la MFA protège les comptes staff)."
  type        = bool
  default     = false
}

variable "staff_mfa_reauth_minutes" {
  description = "Un facteur MFA validé depuis moins de N minutes n'est pas redemandé (évite le double prompt connexion + application)."
  type        = number
  default     = 10
}

variable "email_from" {
  description = "Expéditeur des e-mails de vérification (le serveur SMTP est configuré côté rôle ansible authentik). Vide = noreply@<domain>."
  type        = string
  default     = ""
}

variable "staff_invitation_group" {
  description = "Groupe (identity.groups) dans lequel le flow d'invitation staff place les nouveaux comptes. Moindre privilège par défaut ; promouvoir ensuite à la main."
  type        = string
  default     = "ctf-managers"
}

variable "email_token_expiry_minutes" {
  description = "Durée de validité du lien de vérification d'e-mail, en minutes."
  type        = number
  default     = 30
}

variable "netbird_dashboard_public" {
  description = "true : client OAuth2 NetBird public (PKCE, sans secret). false : confidentiel (connecteur OIDC côté serveur NetBird, cas nominal)."
  type        = bool
  default     = false
}

variable "proxmox_url" {
  description = "URL publique du realm OpenID Proxmox (origine exacte vue par le navigateur). Vide = proxmox_url de secrets/site.sops.yaml."
  type        = string
  default     = ""
}

variable "ctfd_extra_redirect_uris" {
  description = "Redirect URIs supplémentaires pour le client ctfd (réservé : CTFd est headless, l'OIDC est porté par le front). Vide = aucune URI utile."
  type        = list(string)
  default     = []
}

variable "internal_ui_hosts" {
  description = "Sous-domaines (de `domain`) des UIs internes protégées par forward-auth. TODO : à ajouter au contrat (hostnames) ; routage Traefik/Hubble à poser côté edge."
  type        = map(string)
  default = {
    victoriametrics = "vm"
    alertmanager    = "alertmanager"
    hubble          = "hubble"
  }
}
