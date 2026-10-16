# Stack 50-warpgate

Configure le bastion Warpgate (rôle ansible `warpgate`) : rôles liés aux groupes Authentik et targets SSH/HTTP vers les zones.

- Provider : `warp-tech/warpgate` **1.2.0** (provider communautaire du dépôt `warp-tech/terraform-provider-warpgate`, dernier tag relevé ; compatible Warpgate 0.29, la version épinglée par le rôle ansible). Les schémas ont été relevés dans la documentation du dépôt.
- Auth : jeton d'API admin dans `secrets/warpgate-tofu.sops.yaml` (modèle `secrets/warpgate-tofu.example.yaml`, clé `api_token`).
- URL de l'API : `https://<hostnames.bastion>.<domain>` par défaut (`warpgate_api_url` pour la surcharger, par exemple l'accès direct `https://<services.warpgate.ip>:<ports.warpgate.https>` avec `insecure_skip_verify = true`, le certificat étant auto-signé).
- State : local, chiffré (`pbkdf2` + `aes_gcm`), `.state/tofu/50-warpgate.tfstate`.

## Ordre d'amorçage

1. Rôle ansible `warpgate` (compte local `admin`).
2. UI admin > création d'un jeton d'API, à placer dans `secrets/warpgate-tofu.sops.yaml`.
3. `task tofu:apply-warpgate` (ou `task tofu:apply-stack STACK=50-warpgate`).
4. Copier la clé publique de Warpgate (output `warpgate_client_public_keys`) dans `authorized_keys` des targets SSH.

## Ressources

| Fichier | Contenu |
|---|---|
| `roles.tf` | Un rôle par groupe de `access_groups` (défaut `infra-admins`), nom identique au groupe Authentik. Le rôle ansible mappe le claim `groups` sur ce nom (`role_mappings`). |
| `targets.tf` | SSH : LXC de services (hors warpgate), OPNsense (IP MGMT du routeur), hôte Proxmox (`host.mgmt_ip`). HTTP : UI OPNsense, UI/API Proxmox (`:8006`). Affectation de chaque target à chaque rôle d'accès. |

Les IPs et ports viennent de `infra/contracts.yaml`. Les nœuds Talos n'ont pas de SSH (API-only) : `talosctl` depuis le bastion (flux BASTION vers 50000 de la matrice). Une target `kubernetes_options` (API kube 6443) reste à faire : elle demande un jeton ou un certificat de service (TODO).

## OIDC et rôles

OIDC pour l'UI web (provider `custom`, client `pad-warpgate`, mapping `groups` vers rôles, `warpgate:admin` pour `infra-admins`) est configuré dans `warpgate.yaml` par le rôle ansible : le provider Terraform ne gère pas les fournisseurs SSO. Ce stack crée les rôles d'accès vers lesquels le mapping pointe, et y rattache les targets. Les utilisateurs sont créés à la première connexion SSO (`auto_create_users`), donc aucun `warpgate_user` n'est déclaré.

## Limite connue (validée)

OIDC ne couvre que l'interface web. Les connexions SSH passent :

1. soit par **clé publique** de l'utilisateur Warpgate (identifiant `warpgate_public_key_credential`, ajoutable dans l'UI) ;
2. soit par **lien d'autorisation web** : la politique par défaut des utilisateurs SSO est `ssh: [web]` ; Warpgate affiche une URL à ouvrir dans le navigateur, session SSO requise.

Pas d'authentification par mot de passe SSH ni de SSO natif dans le client SSH. Le compte local `admin` reste le secours si Authentik est indisponible. Exemple : `ssh -p <ports.warpgate.ssh> <utilisateur>:<target>@<bastion>.<domain>` (voir output `ssh_connection_example`).

Côté targets, l'authentification est la clé publique propre à Warpgate (`public_key_auth`) : pas de mot de passe stocké dans le state.

## Limites

- L'utilisateur SSH de la target hôte Proxmox vient de `secrets/site.sops.yaml` (`ssh_user`).
- Le state contient l'état des targets (sans secret : pas de mot de passe de target). Il reste chiffré.
- `.terraform.lock.hcl` à générer (`task tofu:lock`) dès que le registry est accessible, puis à commiter (convention du repo).
- Le comportement de `warpgate_ssh_own_keys` (clés présentées par Warpgate aux targets) est à confirmer au premier `plan`.
