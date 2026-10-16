# Rôle warpgate

Warpgate dans `/opt/pad/warpgate` (Docker Compose), image épinglée par digest, données persistantes dans `data/` (base SQLite, clés SSH, certificat TLS auto-signé, `warpgate.yaml`). Listeners SSH 2222 et HTTPS 8888 (contrat `ports.warpgate`).

## Version

Le contrat de versions (`versions.yml`) épingle Warpgate **0.29.2**, pas 0.12.0. Vérifié dans le code : seule la lignée récente (0.29) permet le mapping des groupes OIDC vers les rôles d'administration (`admin_role_mappings`, `roles_claim` / `admin_roles_claim`) ; 0.12 ne connaît que `role_mappings`.

## SSO Authentik

- Fournisseur `custom` (client `pad-warpgate`, issuer `https://<auth>.<domain>/application/o/pad-warpgate/`). Redirect URI côté Authentik : `https://<bastion>.<domain>/@warpgate/api/sso/return` (à confirmer dans l'UI Warpgate, page de config SSO).
- Claim `groups` : le groupe `infra-admins` est mappé sur le rôle admin intégré `warpgate:admin` et sur le rôle d'accès `infra-admins` (à créer par la stack tofu 50-warpgate).
- Les utilisateurs sont créés à la première connexion SSO (`auto_create_users`).

## Limite connue

OIDC ne couvre que l'interface web. Les connexions SSH passent par clé publique ou par lien d'authentification web : la politique par défaut des utilisateurs SSO est `ssh: [web]` (Warpgate affiche un lien à ouvrir dans le navigateur, session SSO requise). Le compte local `admin` (mot de passe SOPS) reste le secours si Authentik est indisponible.

## Notes d'exploitation

- `unattended-setup` ne s'exécute qu'une fois (absence de `data/warpgate.yaml`) ; ensuite Ansible gère `warpgate.yaml`. Les modifications faites dans l'UI sur les fournisseurs SSO sont écrasées.
- L'edge Traefik doit joindre `https://10.20.30.10:8888` avec un transport qui ignore la vérification du certificat auto-signé, et Warpgate fait confiance aux en-têtes `X-Forwarded-*`.
- Secrets : `secrets/warpgate.sops.yaml` (modèle : `secrets/warpgate.example.yaml`).
