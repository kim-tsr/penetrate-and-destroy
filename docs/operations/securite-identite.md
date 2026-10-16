# Identité : MFA, privilèges, console d'administration

Ce que la stack `30-authentik`, le rôle edge et ArgoCD imposent, et ce que l'opérateur doit faire à la main.

## Séparation des privilèges

| Groupe | Accès |
|---|---|
| `ctf-players` | front, NetBird |
| `ctf-managers` | front (portail manager), NetBird |
| `ctf-admins` | administrateurs d'**un événement** : admin CTFd, front, NetBird. Aucun accès à l'infrastructure |
| `infra-admins` | tout, dont ArgoCD, Warpgate, Grafana, Proxmox et le forward-auth des UIs internes |

ArgoCD n'accorde `role:admin` qu'à `infra-admins`, sans droit par défaut, et le compte local `admin` est désactivé.
Secours si l'OIDC est cassé : `argocd login --core` avec les droits `kubectl` de l'opérateur.

## MFA obligatoire pour le staff

`ctf-managers`, `ctf-admins` et `infra-admins` doivent valider un second facteur (TOTP ou WebAuthn) :

1. dans le flow de connexion `pad-authentication` ;
2. dans le flow d'autorisation `pad-provider-authorization`, utilisé par **tous** les providers. Un compte staff qui se
   connecterait par un autre flow d'authentification (le `default-authentication-flow` d'Authentik existe toujours) ne
   peut donc pas obtenir de jeton pour les applications.

Un compte staff sans facteur est forcé d'en enrôler un à la première connexion. Un facteur validé depuis moins de
`staff_mfa_reauth_minutes` (10) minutes n'est pas redemandé. Les joueurs ne sont pas forcés mais valident leur facteur
s'ils en ont configuré un.

Récupération : un administrateur supprime l'appareil dans Authentik (Directory > Users > MFA devices), le staff en
enrôle un nouveau. Si le dernier `infra-admins` perd son facteur : `docker exec` dans le conteneur `server` d'Authentik
et `ak shell` depuis le bastion.

## Durée des sessions et refresh token

Le front revalide les groupes de l'utilisateur via le **refresh token** OIDC : le scope `offline_access` est demandé par le front et rattaché à son seul provider (les autres clients n'obtiennent pas de refresh token).
L'access token vit 10 minutes (`access_token_validity`), le refresh token 12 heures (`refresh_token_validity`, jamais en dessous de la durée de session du front). Retirer un utilisateur d'un groupe prend donc effet au prochain renouvellement,
au plus tard à l'expiration du refresh token.

## Anti-brute-force

- Le flow est annulé après 5 mots de passe faux.
- Une policy de réputation refuse la connexion d'une IP au-delà de 20 échecs cumulés (`login_reputation_threshold`).
  Le verrouillage par identifiant est désactivé par défaut (`login_reputation_check_username`) : sinon un joueur
  pourrait verrouiller un compte staff en échouant exprès ; la MFA protège les comptes staff.
- Le score expire avec les entrées de réputation d'Authentik. Pour débloquer une IP : Events > Reputation.
- CrowdSec, côté edge, bannit en plus les scans et les rafales.

## Inscription des joueurs

Le captcha est activé par défaut. Il faut fournir `captcha_public_key` et `captcha_private_key` dans
`secrets/authentik-tofu.sops.yaml` (Cloudflare Turnstile par défaut ; hCaptcha ou reCAPTCHA via `captcha_js_url` et
`captcha_api_url`). Sans clés, `tofu plan` échoue. Désactivation explicite : `-var captcha_enabled=false`.

Le changement d'e-mail, de pseudo et de nom par l'utilisateur est désactivé (`authentik_system_settings`) : l'e-mail
sert de clé de liaison de compte côté CTFd.

## Console d'administration d'Authentik hors Internet

L'edge n'expose plus `/if/admin` ni `/api/v3/{admin,rbac,outposts,providers,propertymappings,crypto,managed}` que
depuis les CIDR de `edge_traefik_crowdsec_authentik_admin_allowed_cidrs` (bastion et management par défaut). Les flows,
`/if/user`, OIDC et le reste de l'API restent publics, protégés par les permissions d'Authentik.

- Accès humain : se connecter à NetBird, ouvrir Warpgate (cible HTTP vers le LXC Authentik) ou atteindre directement
  l'IP du LXC depuis la zone bastion.
- `tofu apply` de `30-authentik` : à lancer depuis le bastion ou la zone management (le provider appelle les chemins
  bloqués). Depuis un autre poste, ajouter temporairement son CIDR dans la variable du rôle puis rejouer le rôle edge.

## En-têtes de sécurité et IP cliente

- Le front pose son propre CSP (nonce + `strict-dynamic`). Le middleware `headers` de Traefik **remplace** le CSP de la
  réponse : le front passe par la chaîne `edge-front`, sans CSP à l'edge. Les autres hôtes gardent un CSP minimal.
- L'edge ne configure aucun `trustedIPs` : tout `X-Forwarded-For` entrant est écrasé par l'adresse réelle du client.
  Le Traefik du cluster ne fait confiance qu'à l'IP de l'edge. Vérification : `curl -H 'X-Forwarded-For: 1.2.3.4'
  https://<front>/` depuis Internet, l'IP journalisée côté front doit être la vôtre.
