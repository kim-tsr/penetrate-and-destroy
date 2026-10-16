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
- `no-new-privileges` ; politique de mot de passe (`authentik_policy_password`) et captcha à l'inscription.
- Authentik n'est joignable depuis la DMZ que sur 443 ; groupes de rôles `ctf-players`, `ctf-managers`, `ctf-admins`, `infra-admins`.

## Supervision

- Métriques sur le port 9300 (job `authentik`), logs via Alloy ; alerte `AuthentikServerErrors` : [Authentik](../runbooks/authentik.md).
- Dashboard `pad-security`.

## Opérations courantes

```bash
task ansible:services -- --tags authentik --limit authentik
task tofu:apply-stack STACK=30-authentik
# sur le LXC : sauvegarde à la demande
systemctl start authentik-backup.service
```

## Pièges connus

- Authentik doit être déployé avant Warpgate et NetBird (leurs connecteurs OIDC en dépendent) : l'ordre de `services.yml` le respecte.
- Aligner la version du provider tofu sur celle du serveur.

## Documentation officielle

[docs.goauthentik.io](https://docs.goauthentik.io/)

[Retour à l'index des composants](index.md){ .md-button }
