# ADR 2 : Fournisseur d'identité : Authentik

**Statut** : acceptée.

## Contexte

Il faut un SSO unique pour le front, NetBird, Warpgate, Grafana et ArgoCD, une inscription libre des joueurs (captcha, vérification d'e-mail), des invitations pour le staff, et une configuration 100 % IaC.

## Décision

**Authentik** est déployé en Docker Compose dans le LXC `authentik` (zone IDENTITY). Les applications, providers OIDC, groupes (`ctf-players`, `ctf-managers`, `ctf-admins`, `infra-admins`) et flows sont déclarés par la stack OpenTofu `30-authentik` et des blueprints. Un outpost forward-auth protège les applications sans OIDC (VictoriaMetrics, Alertmanager, Hubble). Depuis la version 2025.10, Authentik n'utilise plus Redis.

## Alternatives écartées

- **Zitadel** : plus léger et excellent en multi-tenant B2B, mais le multi-organisation est inutile ici, et il est plus pauvre en forward-auth et en flows personnalisables.
- **Keycloak** : puissant mais plus lourd en mémoire, et les flows d'inscription avec captcha demandent plus de développement.
- **CTFd seul (comptes locaux)** : ne résout ni le SSO des outils d'infrastructure ni la séparation des rôles.

## Conséquences

- Authentik devient un point critique : sa panne bloque les connexions (voir [Authentik](../runbooks/authentik.md)). Le compte local `admin` de Warpgate et un mode de secours CTFd (`PAD_LOCAL_LOGIN_BREAKGLASS`) existent pour ce cas.
- La configuration OIDC de Warpgate reste côté Ansible : le provider OpenTofu ne gère pas les fournisseurs SSO de Warpgate.
- Les secrets clients OIDC sont des sorties de la stack `30-authentik`, à reporter dans les fichiers SOPS.
