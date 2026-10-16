# Provider goauthentik/authentik

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 2026.8.0

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `goauthentik/authentik`. Déclare dans Authentik les groupes du contrat, les providers OAuth2 et applications (un par client OIDC), les flows d'inscription joueur et staff, les stages (captcha, e-mail, mot de passe, MFA TOTP et WebAuthn), la réputation anti-brute-force, les réglages système (utilisateurs ne modifiant pas e-mail, pseudo ni nom) et le provider proxy (forward-auth) des interfaces internes.

Utilisé par : 30-authentik. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 30-authentik.

## Version épinglée

`goauthentik/authentik` **2026.8.0**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/30-authentik/` (`oidc.tf`, `flows.tf`, `groups.tf`, `proxy.tf`, `brand.tf`)
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l'API d'[Authentik](authentik.md) ; produit les secrets des clients OIDC ensuite consommés par [NetBird](netbird.md), [Warpgate](warpgate.md), [Grafana](grafana.md), [ArgoCD](argocd.md) et le [front](frontend.md).
Orchestré par [OpenTofu](opentofu.md) ; secrets lus par le [provider sops](tofu-sops.md).

## Sécurité

Jeton d'API dans `secrets/authentik-tofu.sops.yaml` (avec les clés du captcha). Les secrets clients OIDC sont générés par `random_password` et exposés en sortie sensible `oidc_client_secrets` ; `task secrets:oidc-sync` les recopie dans les sops (NetBird, Warpgate, Grafana, front).
Variables utiles : `captcha_enabled` (défaut `true`), `staff_mfa_reauth_minutes` (10), `login_max_failed_attempts` (5), `login_reputation_threshold` (20), `login_reputation_check_username` (`false`), `access_token_validity` (10 min), `refresh_token_validity` (12 h).
Le scope `offline_access` n'est rattaché qu'au client du front. `infra-admins` est le seul groupe admin des clients ArgoCD, Warpgate, Grafana et Proxmox et du forward-auth ; `ctf-admins` n'administre qu'un événement.

## Supervision

Aucune métrique propre. La dérive se voit par `task tofu:plan-stack STACK=<nom>` ; les ressources pilotées sont
supervisées par leurs briques. En cas de panne d'une stack : [Incident générique](../runbooks/incident.md).

## Opérations courantes

```bash
task tofu:plan-stack STACK=<stack>
task tofu:apply-stack STACK=<stack>
task tofu:lock        # régénère les verrous après un changement de version
```

## Pièges connus

- La version du provider suit celle du serveur Authentik (`2026.8.x`) : les mettre à jour ensemble.
- Le provider appelle des chemins d'administration que l'edge filtre : appliquer cette stack depuis le bastion ou la zone management.
- Sans clés de captcha, le plan échoue (désactivation explicite : `-var captcha_enabled=false`).

## Documentation officielle

[Registry : goauthentik/authentik](https://registry.terraform.io/providers/goauthentik/authentik/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
