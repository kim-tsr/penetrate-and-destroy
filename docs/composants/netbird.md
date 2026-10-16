# NetBird

**Couche** : Services LXC · **Où** : LXC `netbird` (zone DMZ, 10.20.20.11) + routing peers · **Version** : serveur 0.81.0, dashboard v2.95.0 (digests épinglés)

## À quoi elle sert ici et pourquoi ce choix

Les instances de challenges ne sont **jamais** exposées sur Internet : le joueur se connecte au VPN NetBird, qui route vers
l'IP d'instance (zone CHALLENGES) uniquement pour le groupe de son équipe. Le staff passe par NetBird pour atteindre le
bastion [Warpgate](warpgate.md). NetBird est auto-hébergeable, pilotable par API/IaC et s'intègre en OIDC à [Authentik](authentik.md).

## Où elle tourne et comment elle est déployée

Docker Compose dans le LXC `netbird` (rôle `netbird-server`) : image combinée `netbird-server` (management + signal +
relay + STUN) et dashboard. Le STUN UDP 3478 est publié directement. Coturn n'est pas déployé (relay intégré suffisant).
Amorçage **en deux passes** : déploiement avec le propriétaire local, création d'un jeton d'accès (PAT) dans le dashboard,
ajout dans `secrets/netbird.sops.yaml`, second passage (connecteur Authentik et groupes JWT). Puis la stack tofu `40-netbird`.

## Version épinglée

`pad_images.netbird_server` (0.81.0) et `pad_images.netbird_dashboard` (v2.95.0), `pad_images.coturn` (4.18.0, non déployé par défaut),
dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`. Provider tofu : `netbirdio/netbird` 0.0.10 ([page](tofu-netbird.md)).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/netbird-server/` (`compose.yml.j2`, `config.yaml.j2`, `dashboard.env.j2`, `README.md`).
- `infra/tofu/stacks/40-netbird/` : groupes, networks `pad-instances` et `pad-bastion`, policies, clés d'installation.
- `infra/contracts.yaml` : section `netbird` (groupes, CIDR overlay `100.64.0.0/10`, préfixe `ctf-team-`).
- `secrets/netbird.example.yaml`, `secrets/netbird-tofu.example.yaml`.

## Interactions avec les autres briques

- Exposé par [Traefik edge](traefik-edge.md) (gRPC en h2c, `/relay`, `/api`, `/oauth2`, dashboard).
- Authentifie via [Authentik](authentik.md) (connecteur OIDC, groupes JWT).
- [netbird-sync](netbird-sync.md) crée par API les ressources et policies d'instance, par équipe.
- Les routing peers donnent accès à la zone CHALLENGES et au LXC bastion.

## Sécurité

- Deny all par défaut : désactiver la policy « Default » ; seule une policy d'instance ouvre un accès, pour un groupe d'équipe.
- Filtrage des groupes JWT (`jwt_allow_groups` = groupes du contrat).
- `no-new-privileges`, mémoire bornée, journaux Docker bornés. TLS terminé à l'edge.

## Supervision

- Métriques sur le port 9090 (job `netbird`) ; dashboard `pad-security`.
- Alertes liées : `NetbirdSync*` ([netbird-sync](../runbooks/netbird-sync.md)) ; accès VPN : [Incident](../runbooks/incident.md).

## Opérations courantes

```bash
task ansible:services -- --tags netbird --limit netbird
task tofu:apply-netbird          # groupes, networks, policies (PAT requis)
```

## Pièges connus

- Le serveur combiné embarque toujours un IdP interne (Dex) : Authentik est ajouté comme connecteur par l'API, pas dans `config.yaml`.
- Le LXC doit pouvoir joindre `https://<auth>.<domaine>` pour la découverte OIDC.
- La plage `turn_relay_range` du contrat reste inutilisée sans Coturn.

## Documentation officielle

[docs.netbird.io](https://docs.netbird.io/)

[Retour à l'index des composants](index.md){ .md-button }
