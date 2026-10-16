# Authentik

**Couche** : Services LXC · **Où** : LXC `authentik` (zone IDENTITY, 10.20.40.10) · **Version** : 2026.8.4 (image) ; PostgreSQL 16.15

## À quoi elle sert ici et pourquoi ce choix

IdP unique : il authentifie les joueurs (inscription avec captcha et vérification d'e-mail), le personnel, et alimente le
front, NetBird, Warpgate, Grafana, ArgoCD et Proxmox en OIDC. Il fournit aussi des flows d'inscription, un forward-auth
(provider proxy) pour les interfaces internes et un branding. Décision : [ADR 2](../adr/002-idp-authentik.md).

## Où elle tourne et comment elle est déployée

Docker Compose dans le LXC `authentik` (rôle `authentik`) : `server`, `worker` et PostgreSQL. L'HTTPS est publié sur le port 443
du LXC (9443 du conteneur), pour que DMZ vers IDENTITY ne soit que du 443. Une sauvegarde `pg_dump` quotidienne (03:15, 7 jours)
est planifiée par un timer systemd. La configuration applicative (groupes, clients, flows) est ensuite posée par la stack tofu `30-authentik`.

## Version épinglée

`pad_images.authentik` (2026.8.4) et `pad_images.postgres` (16.15-alpine) dans
`infra/ansible/inventories/prod/group_vars/all/versions.yml`. Provider tofu `goauthentik/authentik` 2026.8.0 ([page](tofu-authentik.md)).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/authentik/` : `compose.yml.j2`, `authentik.env.j2`, sauvegarde (`authentik-backup.*.j2`), `files/blueprints/` (branding, pied de page).
- `infra/tofu/stacks/30-authentik/` : `oidc.tf`, `flows.tf`, `groups.tf`, `proxy.tf`, `brand.tf`.
- `infra/contracts.yaml` : `identity.groups` et `identity.oidc_clients`.
- `secrets/authentik.example.yaml`, `secrets/authentik-tofu.example.yaml`.

## Interactions avec les autres briques

- Exposé par [Traefik edge](traefik-edge.md) sous `auth.<domaine>`.
- Clients OIDC : front ([Auth.js](frontend.md)), [NetBird](netbird.md), [Warpgate](warpgate.md), [Grafana](grafana.md), [ArgoCD](argocd.md), Proxmox, CTFd.
- Configuré par [OpenTofu](tofu-authentik.md) ; télémétrie par [Alloy](alloy.md).

## Sécurité

- Pas de collecte : mise à jour, analytique de démarrage et rapport d'erreurs désactivés.
- `no-new-privileges` ; politique de mot de passe (`authentik_policy_password`) et captcha à l'inscription (activé par défaut, clés fournies par l'opérateur).
- Authentik n'est joignable depuis la DMZ que sur 443 ; groupes de rôles `ctf-players`, `ctf-managers`, `ctf-admins` (administrateurs d'**un événement**, sans accès à l'infrastructure) et `infra-admins` (seul groupe admin d'ArgoCD, Warpgate, Grafana, Proxmox et du forward-auth).
- **MFA obligatoire** (TOTP ou WebAuthn) pour `ctf-managers`, `ctf-admins` et `infra-admins`, au flow de connexion **et** au flow d'autorisation commun à tous les providers : un compte staff ne peut obtenir de jeton d'aucune application sans second facteur. Enrôlement forcé à la première connexion.
- **Anti-brute-force** : flow annulé après 5 mots de passe faux et réputation par IP (20 échecs cumulés, `login_reputation_threshold`) ; le verrouillage par identifiant est désactivé par défaut pour qu'un joueur ne puisse pas bloquer un compte staff.
- Les utilisateurs ne peuvent plus changer eux-mêmes e-mail, pseudo ni nom (l'e-mail est la clé de liaison avec CTFd et NetBird).
- Durées de jeton : access token 10 min ; refresh token 12 h, émis grâce au scope `offline_access` rattaché aux seuls clients qui le demandent (le front revalide les groupes via le refresh token).
- **Console d'administration hors Internet** : l'edge ne laisse atteindre `/if/admin` et les API d'administration (`/api/v3/admin`, `rbac`, `outposts`, `providers`, `propertymappings`, `crypto`, `managed`) que depuis les CIDR du bastion et du management
  (`edge_traefik_crowdsec_authentik_admin_allowed_cidrs`). Détail : [Identité](../operations/securite-identite.md).

## Supervision

- Métriques sur le port 9300 (job `authentik`), logs via Alloy ; alerte `AuthentikServerErrors` : [Authentik](../runbooks/authentik.md).
- Dashboard `pad-security`.

## Opérations courantes

```bash
task ansible:services -- --tags authentik --limit authentik
# depuis le bastion ou la zone management (le provider appelle les chemins d'administration filtrés à l'edge)
task tofu:apply-stack STACK=30-authentik
task secrets:oidc-sync        # recopie les secrets des clients OIDC (sortie tofu) dans les sops
# sur le LXC : sauvegarde à la demande
systemctl start authentik-backup.service
```

## Pièges connus

- Authentik doit être déployé avant Warpgate et NetBird (leurs connecteurs OIDC en dépendent), et leurs secrets OIDC sont générés par `30-authentik` : `task up` déploie les services en deux passes autour de cette stack ([Up](../runbooks/up.md)).
- `tofu apply` de `30-authentik` échoue (403 ou page d'erreur) depuis un poste hors des CIDR autorisés : le lancer depuis le bastion ou le management.
- Sans clés de captcha, `tofu plan` échoue (`captcha_enabled` vaut `true` par défaut) : [Actions manuelles](../operations/actions-post-deploiement.md).
- Aligner la version du provider tofu sur celle du serveur.

## Documentation officielle

[docs.goauthentik.io](https://docs.goauthentik.io/)

[Retour à l'index des composants](index.md){ .md-button }
