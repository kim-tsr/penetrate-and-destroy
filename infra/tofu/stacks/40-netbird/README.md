# Stack 40-netbird

Configure NetBird (self-hosted, déployé par le rôle ansible `netbird-server`) : groupes, réseaux et routing peers, policies de la matrice de flux, setup keys, utilisateur de service de `apps/netbird-sync`.

- Provider : `netbirdio/netbird` **0.0.10** (dernier tag du dépôt `netbirdio/terraform-provider-netbird` au moment de l'écriture ; provider jeune, API susceptible de changer : Renovate le suit). Les schémas ont été relevés dans la documentation du dépôt, sans pouvoir être validés contre le registry (voir « Validation »).
- Auth : jeton d'accès personnel (PAT) dans `secrets/netbird-tofu.sops.yaml` (modèle `secrets/netbird-tofu.example.yaml`, clé `api_token`). URL : `https://<hostnames.vpn>.<domain>` (contrat).
- State : local, chiffré (`pbkdf2` + `aes_gcm`), `.state/tofu/40-netbird.tfstate`, passphrase `TF_VAR_state_passphrase`.

## Ordre d'amorçage

1. Rôle ansible `netbird-server`, passe 1 (owner local), puis création d'un PAT dans le dashboard.
2. Mettre ce PAT dans `secrets/netbird.sops.yaml` (`netbird_server_api_token`, passe 2 ansible) et dans `secrets/netbird-tofu.sops.yaml` (`api_token`).
3. `task tofu:apply-netbird` (ou `task tofu:apply-stack STACK=40-netbird`).
4. Post-actions manuelles (limites du provider, voir ci-dessous).

## Ressources

| Fichier | Contenu |
|---|---|
| `groups.tf` | Un groupe par `identity.groups` (alimentés par le claim `groups` d'Authentik), `pad-routers-challenges`, `pad-routers-bastion`, `pad-bastion`. |
| `networks.tf` | Network `netbird.network_name` (instances) + routeur sur les peers du groupe `pad-routers-challenges` ; network `pad-bastion` + routeur + resource = CIDR de la zone BASTION. |
| `policies.tf` | `staff-vers-bastion` : `netbird.groups.staff` vers la zone BASTION, TCP `flow_ports.warpgate` uniquement. |
| `setup_keys.tf` | Une setup key par routing peer (auto-groupe du routeur). |
| `service_users.tf` | Utilisateur de service `netbird-sync`. |
| `identity_provider.tf` | Connecteur OIDC Authentik + groupes JWT, **désactivé par défaut** (`manage_identity_provider`). |

## Partage avec `apps/netbird-sync`

`netbird-sync` retrouve par nom le network `pad-instances` (`netbird.network_name`) et son groupe de resources du même nom (`EnsureNetwork` / `EnsureGroup`), puis crée les resources `/32` (IP LB d'instance) et une policy par instance et par équipe (source : groupe `ctf-team-<id>`). Ce stack ne déclare **aucune** resource ni policy d'instance, pour éviter les conflits de propriété. Sans policy d'instance, un joueur n'atteint rien.

Le groupe `ctf-team-<id>` est créé par netbird-sync ; le rattachement des joueurs à leur groupe d'équipe relève de l'application (hors périmètre de ce stack).

PAT de netbird-sync : le provider ne sait créer un token que pour l'utilisateur courant. Créer à la main le PAT de l'utilisateur de service `netbird-sync` (Dashboard > Team > Service Users), puis le placer dans le secret SOPS de `gitops/apps/netbird-sync` (`NETBIRD_API_TOKEN`). `NETBIRD_API_URL` = output `management_url` (le client de netbird-sync accepte l'URL avec ou sans `/api`).

## Routing peers

Matrice de flux : joueurs vers CHALLENGES uniquement, staff vers BASTION uniquement. Deux routing peers sont donc nécessaires, un par zone (un peer dans CHALLENGES ne doit pas atteindre BASTION, `CHALLENGES -> *` est refusé).

| Peer | IP | Network | Setup key (output sensible `routing_peer_setup_keys`) |
|---|---|---|---|
| CHALLENGES | `netbird.routing_peer_ip` | `pad-instances` | `challenges` |
| BASTION | `services.warpgate.ip` (agent NetBird sur le LXC warpgate) | `pad-bastion` | `bastion` |

L'enrôlement lui-même (`netbird up --setup-key ... --management-url ...`) relève d'ansible (LXC) / gitops (DaemonSet hostNetwork), non couvert ici. Le routeur est en masquerade : les cibles voient l'IP du routing peer (les règles OPNsense doivent autoriser ces IPs).

## Intégration Authentik (OIDC)

Le provider expose `netbird_identity_provider` (type `oidc`) et `netbird_account_settings` (`jwt_groups_*`). Les deux sont codés dans `identity_provider.tf` mais **désactivés** : le rôle ansible `netbird-server` (`tasks/idp.yml`) le fait déjà et deux gestionnaires se disputeraient la même ressource. Pour basculer sur tofu : `manage_identity_provider = true` (lit `netbird_server_authentik_client_secret` dans `secrets/netbird.sops.yaml`), puis retirer la tâche côté ansible. `netbird_account_settings` n'a pas été testé : ses attributs non renseignés pourraient être remis à leur valeur par défaut.

Les groupes IdP du contrat sont pré-créés ici (`netbird_group.idp`) ; la synchronisation JWT rattache ensuite les utilisateurs par nom. À vérifier au premier déploiement qu'aucun doublon `issued = jwt` n'apparaît.

## Limites et actions manuelles

- **Policy « Default »** : NetBird crée à l'initialisation une policy All <-> All. Elle doit être **désactivée ou supprimée** (dashboard > Access Control) pour obtenir le deny all par défaut. Non géré ici (le groupe « All » n'est pas modélisé).
- PAT de `netbird-sync` : manuel (voir plus haut).
- Setup keys : la valeur n'est lisible que dans le state chiffré / l'output sensible. `expiry_seconds` ne peut pas être relu par le provider.

## Validation

Hors ligne : `tofu fmt -check`, `tofu init -backend=false`, `tofu validate`. Aucun `terraform.tfvars` n'est nécessaire pour `validate` ; `terraform.tfvars.example` documente les variables facultatives. `plan` exige NetBird déployé et les secrets SOPS.
