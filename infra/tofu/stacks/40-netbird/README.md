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
| `service_users.tf` | Utilisateurs de service `netbird-sync` (`network_admin`) et `pad-frontend-readonly` (`auditor`). |
| `identity_provider.tf` | Connecteur OIDC Authentik + groupes JWT, **désactivé par défaut** (`manage_identity_provider`). |

## Partage avec `apps/netbird-sync`

`netbird-sync` retrouve par nom le network `pad-instances` (`netbird.network_name`) et son groupe de resources du même nom (`EnsureNetwork` / `EnsureGroup`), puis crée les resources `/32` (IP LB d'instance) et une policy par instance et par équipe (source : groupe `ctf-team-<id>`). Ce stack ne déclare **aucune** resource ni policy d'instance, pour éviter les conflits de propriété. Sans policy d'instance, un joueur n'atteint rien.

Le groupe `ctf-team-<id>` est créé par netbird-sync, **qui y rattache aussi les joueurs** : pour chaque équipe ayant un namespace d'instance, il lit les membres dans CTFd (endpoint interne `pad_teams`, `GET /api/v1/pad/internal/sources/team/<id>`, jeton `PAD_INTERNAL_TOKEN`), retrouve les utilisateurs NetBird par **e-mail** (le même que celui du compte CTFd, issu d'Authentik) et fait en sorte que le groupe contienne exactement leurs pairs (ajouts, retraits, équipe supprimée ou bannie = groupe vidé), à chaque réconciliation de Service et toutes les minutes. Un joueur n'atteint donc que les instances de son équipe. Ne jamais ajouter de policy joueurs vers `pad-instances` ici ni à la main.

Isolation côté cluster : le routeur est en masquerade, l'instance voit l'IP du routing peer ; la NetworkPolicy d'instance n'autorise donc que cette IP (`PAD_FROM_CIDRS`), jamais l'overlay `100.64.0.0/10`. L'isolation entre équipes est portée uniquement par les policies NetBird ci-dessus.

### Utilisateurs de service et jetons (PAT)

Un PAT hérite du rôle de son propriétaire. Le provider ne sait créer un token que pour l'utilisateur courant : créer les PAT à la main (Dashboard > Team > Service Users).

| Service user (créé ici) | Rôle | Usage | Secret SOPS |
|---|---|---|---|
| `netbird-sync` | `network_admin` (variable `netbird_sync_role`) | groupes, networks, resources, policies, pairs des groupes d'équipe | `gitops/apps/netbird-sync` (`NETBIRD_API_TOKEN`) |
| `pad-frontend-readonly` | `auditor` | front : état du tunnel du joueur (`/users`, `/peers`) | `gitops/apps/frontend` (`NETBIRD_API_TOKEN`) |

À vérifier au premier déploiement : `network_admin` n'a pas pu être testé contre un vrai NetBird. Si netbird-sync journalise un HTTP 403 (notamment sur `GET /users`), repasser `netbird_sync_role = "admin"` en connaissance de cause (un jeton admin peut créer des utilisateurs et des jetons). Ne jamais réutiliser le PAT de netbird-sync, ni celui d'un administrateur, pour le front.

`NETBIRD_API_URL` = output `management_url` (le client de netbird-sync accepte l'URL avec ou sans `/api`). `PAD_INTERNAL_TOKEN` du secret netbird-sync doit valoir exactement celui de `gitops/apps/ctfd` (`ctfd-secrets`).

## Routing peers

Matrice de flux : joueurs vers CHALLENGES uniquement, staff vers BASTION uniquement. Deux routing peers sont donc nécessaires, un par zone (un peer dans CHALLENGES ne doit pas atteindre BASTION, `CHALLENGES -> *` est refusé).

| Peer | IP | Network | Setup key (output sensible `routing_peer_setup_keys`) |
|---|---|---|---|
| CHALLENGES | `netbird.routing_peer_ip` | `pad-instances` | `challenges` |
| BASTION | `services.warpgate.ip` (agent NetBird sur le LXC warpgate) | `pad-bastion` | `bastion` |

Enrôlement (automatisé) : cette stack crée les deux setup keys (`setup_keys.tf`, réutilisables, bornées à `setup_key_usage_limit` usages, valables `setup_key_expiry_seconds`, jamais éphémères, groupes automatiques `pad-routers-*`). `task netbird:sync-keys` les recopie dans `secrets/netbird-agent.sops.yaml`, puis le rôle ansible `netbird-agent` (LXC `nbrouter` pour CHALLENGES, LXC warpgate pour BASTION) exécute `netbird up --setup-key ... --management-url ...` une seule fois. Clé expirée ou épuisée : `task netbird:rotate-keys`. Choix `one-off` : plus strict, mais toute reconstruction d'un LXC exige une nouvelle clé. Le routeur est en masquerade : les cibles voient l'IP du routing peer (les règles OPNsense doivent autoriser ces IPs).

## Intégration Authentik (OIDC)

Le provider expose `netbird_identity_provider` (type `oidc`) et `netbird_account_settings` (`jwt_groups_*`). Les deux sont codés dans `identity_provider.tf` mais **désactivés** : le rôle ansible `netbird-server` (`tasks/idp.yml`) le fait déjà et deux gestionnaires se disputeraient la même ressource. Pour basculer sur tofu : `manage_identity_provider = true` (lit `netbird_server_authentik_client_secret` dans `secrets/netbird.sops.yaml`), puis retirer la tâche côté ansible. `netbird_account_settings` n'a pas été testé : ses attributs non renseignés pourraient être remis à leur valeur par défaut.

Les groupes IdP du contrat sont pré-créés ici (`netbird_group.idp`) ; la synchronisation JWT rattache ensuite les utilisateurs par nom. À vérifier au premier déploiement qu'aucun doublon `issued = jwt` n'apparaît.

## Limites et actions manuelles

- **Policy « Default » (étape manuelle OBLIGATOIRE)** : NetBird crée à l'initialisation (et après toute réinstallation) une policy All <-> All. Tant qu'elle est active, tout joueur enrôlé joint tous les pairs et toutes les routes (routing peers, pivot vers BASTION, instances des autres équipes). Elle doit être **supprimée** (dashboard > Access Control > Default). Elle n'est pas gérée par tofu : le provider `netbirdio/netbird` 0.0.10 n'a pas pu être consulté (registry bloqué), et adopter une policy existante exige son ID. **Vérification automatique** : `netbird-sync` refuse de démarrer (journal `refus de démarrer…`), puis n'écrit plus rien dans NetBird, tant qu'une policy active a le groupe « All » en source ; la métrique `netbird_sync_open_policies` doit rester à 0 (alerte conseillée).
- PATs des services users : manuels (voir plus haut).
- Setup keys : la valeur n'est lisible que dans le state chiffré / l'output sensible. `expiry_seconds` ne peut pas être relu par le provider.

## Validation

Hors ligne : `tofu fmt -check`, `tofu init -backend=false`, `tofu validate`. Aucun `terraform.tfvars` n'est nécessaire pour `validate` ; `terraform.tfvars.example` documente les variables facultatives. `plan` exige NetBird déployé et les secrets SOPS.
