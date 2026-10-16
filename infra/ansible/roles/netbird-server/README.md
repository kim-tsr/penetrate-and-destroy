# Rôle netbird-server

NetBird 0.81.0 self-hosted : image combinée `netbird-server` (management + signal + relay intégré + STUN) et dashboard, en Docker Compose dans `/opt/pad/netbird`. Coturn n'est pas déployé (relay intégré suffisant) ; la plage `turn_relay_range` du contrat reste donc inutilisée.

## Notes de conception

- Le serveur combiné embarque toujours un IdP (Dex). Authentik n'est pas déclaré dans `config.yaml` mais ajouté comme connecteur OIDC via l'API (`POST /api/identity-providers`, issuer `https://<auth>.<domain>/application/o/pad-netbird/`). La synchronisation des groupes JWT (`jwt_groups_enabled`, claim `groups`, filtre `jwt_allow_groups` = groupes du contrat) est posée via `PUT /api/accounts/{id}`.
- Amorçage en deux passes : 1) déploiement sans `netbird_server_api_token` (owner local via `netbird_server_owner_password`) ; 2) création d'un PAT dans le dashboard, ajout dans `secrets/netbird.sops.yaml`, nouveau passage (connecteur + groupes). Le redirect URI à déclarer côté Authentik est `https://<vpn>.<domain>/oauth2/callback`.
- Le LXC doit joindre `https://<auth>.<domain>` (découverte OIDC faite par le serveur lors de la création du connecteur).
- Exposition : TLS terminé par Traefik (edge). Routage attendu côté edge vers `10.20.20.11` : gRPC (`/signalexchange.SignalExchange/`, `/management.ManagementService/`) en h2c vers le port 80 ; `/relay`, `/ws-proxy/`, `/api`, `/oauth2` en HTTP vers le port 80 ; le reste vers le dashboard (port 8080). UDP 3478 publié directement par Docker (DNAT OPNsense du contrat).
- Secrets : `secrets/netbird.sops.yaml` (modèle : `secrets/netbird.example.yaml`).
