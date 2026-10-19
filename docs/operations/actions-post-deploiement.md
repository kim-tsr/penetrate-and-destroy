# Actions manuelles après déploiement

`task up` automatise tout ce que les API permettent. Il reste quelques actions qui exigent un geste humain, soit
parce que le fournisseur OpenTofu ne sait pas les faire, soit parce qu'un secret n'existe qu'après le premier
déploiement. **Les faire avant d'ouvrir la plateforme aux joueurs.**

!!! warning "Ordre"
    L'action 1 est un prérequis de `task up`. Les actions 4 à 6 conditionnent la sécurité du réseau : sans elles, soit
    tout le monde atteint tout (action 4), soit personne n'atteint rien (actions 5 et 6). Les actions 7 à 9 conditionnent
    le démarrage des applications et des instances, l'action 10 la sécurité de la chaîne de déploiement.

| # | Action | Quand |
|---|---|---|
| 1 | Clés du captcha | avant `task up` |
| 2 | `tofu apply` de `30-authentik` depuis le bastion ou le management, commit des sops OIDC | pendant `task up` |
| 3 | Enrôler le MFA du premier `infra-admins` | après `30-authentik` |
| 4 | Supprimer la policy NetBird « Default » | après le déploiement de NetBird |
| 5 | Créer les PAT NetBird (`netbird-sync`, front) | après le déploiement de NetBird |
| 6 | Vérifier les routing peers NetBird (enrôlement et règles OPNsense automatisés) | avant le premier événement |
| 7 | Première publication des images (digests de remplacement) | après le premier push sur `main` |
| 8 | Zot : identifiants de pull des nœuds challenges | avant le premier challenge instancié |
| 9 | Clé cosign et passage en `enforce` | une fois les images signées |
| 10 | Protéger la branche `main` | avant tout merge d'un tiers |

## 1. Fournir les clés du captcha

L'inscription des joueurs est protégée par un captcha, **activé par défaut** : sans clés, `tofu plan` de `30-authentik`
échoue et `task up` s'arrête à cette étape.

1. Créer un site chez le fournisseur de captcha (Cloudflare Turnstile par défaut ; hCaptcha ou reCAPTCHA possibles).
   Autoriser le nom d'hôte du front et celui d'Authentik.
2. Placer la clé publique (site key) et la clé privée (secret key) dans `secrets/authentik-tofu.sops.yaml`
   (`captcha_public_key`, `captcha_private_key`) : `sops secrets/authentik-tofu.sops.yaml`. Pour hCaptcha ou reCAPTCHA,
   ajuster `captcha_js_url` et `captcha_api_url` ([Identité](securite-identite.md)).
3. Désactiver le captcha est un choix explicite (`-var captcha_enabled=false`), à réserver aux essais.

## 2. Appliquer `30-authentik` depuis le bastion ou le management

L'edge n'expose plus la console d'administration d'Authentik à Internet : le provider OpenTofu appelle des chemins filtrés
(`/api/v3/admin`, `rbac`, `outposts`, `providers`, `propertymappings`, `crypto`, `managed`) qui ne répondent que depuis les
CIDR du bastion et du management (`edge_traefik_crowdsec_authentik_admin_allowed_cidrs`).

1. Lancer `task tofu:apply-stack STACK=30-authentik` (donc `task up`) **depuis le bastion ou la zone management**. Depuis un autre
   poste, ajouter temporairement son CIDR à cette variable du rôle edge et rejouer
   `task ansible:services -- --tags edge`, puis le retirer.
2. `task up` enchaîne ensuite `task secrets:oidc-sync`, qui recopie les secrets des clients OIDC générés par tofu dans les sops de
   NetBird, Warpgate, Grafana, du front et d'ArgoCD, avant la seconde passe d'Ansible ([Up](../runbooks/up.md)). Commiter les sops
   modifiés (`secrets/*.sops.yaml`, `gitops/apps/frontend/secret.sops.yaml` et `gitops/platform/argocd/secret-oidc.sops.yaml`)
   **avant** `bootstrap:gitops`.
3. **ArgoCD** : rien à faire à la main. Son Secret `argocd-oidc` (clé `clientSecret`) est déclaratif : sops + ksops, appliqué par
   l'Application `root` dès la première synchronisation. Tant que le sops contient `CHANGEME` (oidc-sync non lancé), la connexion SSO
   échoue ; le compte local `admin` est désactivé, utiliser `argocd login --core` avec les droits `kubectl`. Seul le client `proxmox`
   (realm OpenID de Proxmox) se configure à la main.

## 3. Enrôler le MFA du premier administrateur d'infrastructure

Les comptes `ctf-managers`, `ctf-admins` et `infra-admins` doivent valider un second facteur ; le compte du premier opérateur n'en a pas encore.

1. Créer l'utilisateur (invitation staff ou console d'Authentik atteinte depuis le bastion) et l'ajouter au groupe `infra-admins`.
2. À sa première connexion, Authentik le force à enrôler un facteur (TOTP ou WebAuthn) avant tout accès à une application.
   Enrôler **deux** facteurs (par exemple une clé WebAuthn et un TOTP de secours).
3. Tester l'accès à ArgoCD, Warpgate et Grafana : un compte qui n'est pas `infra-admins` ne doit voir aucune de ces applications.
4. Perte du dernier facteur d'un `infra-admins` : voir [Identité](securite-identite.md) (suppression de l'appareil, puis `ak shell` depuis le bastion).

## 4. Supprimer la policy NetBird « Default »

À l'initialisation, NetBird crée une policy **Default** qui autorise tous les pairs à joindre tous les pairs
(`All` vers `All`). Elle annule le « deny all » voulu : un joueur connecté verrait le staff et toutes les instances.

1. Ouvrir le dashboard NetBird (`https://vpn.example.net`), **Access Control > Policies**.
2. Désactiver, puis supprimer la policy **Default**.
3. Vérifier qu'il ne reste que : `staff-vers-bastion` (stack `40-netbird`) et les policies `pad-inst-*` créées par
   `netbird-sync`.

Le provider OpenTofu ne modélise pas le groupe « All » : la suppression elle-même n'est pas automatisable aujourd'hui.
Elle est en revanche **vérifiée automatiquement** : `netbird-sync` refuse de démarrer (et n'écrit plus rien dans NetBird)
tant qu'une policy active a le groupe « All » en source ; le journal indique `refus de démarrer`, la métrique
`netbird_sync_open_policies` reste à 1 ou plus. À refaire après toute réinstallation de NetBird.

## 5. PAT NetBird des utilisateurs de service

Créés par la stack `40-netbird` (ressources `netbird_token`, validité `service_token_expiration_days`, 365 jours) et
recopiés par la phase 11 (`task netbird:sync-tokens`) dans `gitops/apps/netbird-sync/secret.sops.yaml` et
`gitops/apps/frontend/secret.sops.yaml` (clé `NETBIRD_API_TOKEN`). Reste à **commiter et pousser** ces secrets ; ArgoCD
déploie. Contrôler : `kubectl -n netbird-sync logs deploy/netbird-sync` sans erreur 401/403.

Renouvellement (avant échéance) : `task tofu:apply-stack STACK=40-netbird -- -replace=netbird_token.netbird_sync
-replace=netbird_token.frontend_readonly`, puis `task netbird:sync-tokens`, commit et push.

Rôles : l'utilisateur `netbird-sync` est `network_admin` (moindre privilège : groupes, networks, policies, pairs) ; si le journal montre un HTTP 403 (en
particulier sur `GET /users`), passer `netbird_sync_role = "admin"` dans la stack `40-netbird`, en connaissance de cause.
Le PAT du front appartient à `pad-frontend-readonly` (rôle `auditor`) : ne jamais y mettre le jeton de `netbird-sync` ni
celui d'un administrateur, un PAT hérite des droits de son propriétaire.
`PAD_INTERNAL_TOKEN` du secret `netbird-sync` est **identique** à celui de `ctfd-secrets` (netbird-sync lit
les membres d'équipe dans CTFd pour rattacher chaque joueur au groupe `ctf-team-<id>`) : `task secrets:init` l'a déjà recopié, ne le
changer qu'aux deux endroits à la fois. Les e-mails des comptes NetBird (SSO Authentik) et CTFd doivent correspondre.

Sans ce jeton, aucune instance n'est joignable : voir [netbird-sync](../runbooks/netbird-sync.md).

Il faut aussi, une fois NetBird déployé, **un PAT administrateur** pour la stack `40-netbird`
(`secrets/netbird-tofu.sops.yaml`, clé `api_token`) et pour l'amorçage en deux passes du rôle Ansible
(`secrets/netbird.sops.yaml`, `netbird_server_api_token`). Le jeton de Warpgate pour la stack `50-warpgate` suit le même
principe (`secrets/warpgate-tofu.sops.yaml`).

## 6. Routing peers NetBird (automatisés, à vérifier)

NetBird route le trafic par un **routing peer** en masquerade : les cibles voient l'IP du routing peer. Il y en a un par zone,
**enrôlés et autorisés par le dépôt** (phase 11 : setup keys de `40-netbird`, rôle Ansible `netbird-agent`, règles `N1` à `N6`
de `60-opnsense-rules`) :

| Peer | IP | Doit pouvoir joindre | Règles |
|---|---|---|---|
| challenges (LXC `nbrouter`) | `10.20.70.10` | les IP d'instances (pool `10.20.70.100` à `.199`), même zone : aucune règle OPNsense | sortie HTTPS, STUN, UDP direct, apt, NTP |
| bastion (LXC `warpgate`) | `10.20.30.10` | les cibles du bastion | M6 existante + STUN et UDP direct |

Il reste à vérifier : `task check:11-acces` (pairs connectés, routeurs actifs). Si une setup key est expirée ou épuisée :
`task netbird:rotate-keys`. Ces pairs ne survivent pas à `task destroy` mais sont réenrôlés par `task phase:11-acces`.

Test : depuis un poste NetBird d'un joueur, une instance démarrée doit répondre ; sans NetBird, elle ne doit pas répondre.

## 7. Première publication des images

Les manifests `gitops/apps/ctfd`, `frontend` et `netbird-sync` référencent leur image par `tag@sha256:<empreinte>`, avec une
empreinte de remplacement nulle (`sha256:000…`) dans le premier commit. Tant qu'elle n'est pas remplacée, les pods ne démarrent
pas (volontairement) et les Applications restent `Degraded`.

1. Pousser sur `main` : le workflow `images.yml` construit, **scanne (Trivy, bloquant)**, pousse et signe chaque image, puis affiche
   `image@sha256:…` dans le résumé du job.
2. Remplacer l'empreinte dans chaque `deployment.yaml` (ou fusionner la PR Renovate `:pinDigests` qui le fait), vérifier que la
   référence correspond à l'image signée, puis fusionner. ArgoCD déploie.
3. Pour les challenges d'exemple (`challenges/*/challenge.yml`, `registry.pad.internal/ctf/...@sha256:000…`) : pousser l'image dans Zot
   (action 8), relever son empreinte et la reporter dans le `challenge.yml`. Une instance n'est créée qu'avec une empreinte réelle.

## 8. Zot : identifiants de pull des nœuds challenges

Les instances n'acceptent que des images de `registry.pad.internal/ctf/`. La règle d'accès `ctf/**` est déjà dans
`gitops/platform/zot/values.yaml` (`pad-ci` : `read, create, update, delete` ; `pad-pull` : `read` ; `defaultPolicy: []`), et les
comptes htpasswd (`pad-ci`, `pad-pull`) sont générés par `task secrets:init` (mots de passe en clair dans
`secrets/credentials.sops.yaml`). Il reste à donner aux nœuds du pool `challenges` les identifiants de `pad-pull`, **hors Git**
(un mot de passe ne peut pas figurer en clair dans le `TalosConfigTemplate`, et Cluster API ne déchiffre pas de configuration SOPS) :

1. Pour chaque nœud du pool `challenges`, appliquer un patch de configuration machine Talos, sans écrire le mot de passe sur disque
   (substitution de processus ; `registry.pad.internal` = hôte du registre du contrat) :

    ```bash
    pw=$(sops -d --extract '["zot_pad_pull_password"]' secrets/credentials.sops.yaml)
    talosctl -n <ip-du-noeud> patch machineconfig --patch @<(printf '%s\n' \
      "machine:" "  registries:" "    config:" "      registry.pad.internal:" "        auth:" \
      "          username: pad-pull" "          password: ${pw}")
    unset pw
    ```

   Le patch se fusionne avec la configuration TLS de `registry.pad.internal` déjà portée par le template
   (`tls.insecureSkipVerify`, voir [Zot, miroir pull-through](../composants/zot.md#miroir-pull-through-zone-challenges)).
   La documentation Talos indique que le plugin CRI de containerd ne relit les identifiants qu'au redémarrage : si un pull
   `ctf/` répond encore `401`, `talosctl -n <ip-du-noeud> reboot`.
   Les images système de ces nœuds (kubelet, Cilium, CSI...) ne demandent aucun identifiant : elles passent par le cache
   pull-through anonyme `mirror/` de Zot.
2. **Nœuds créés ensuite par l'autoscaler** : ils naissent du `TalosConfigTemplate` du dépôt, donc sans ces identifiants. Rejouer
   l'étape 1 sur chaque nouveau nœud challenges (`kubectl get nodes -l pad.io/pool=challenges -o wide` donne les IP) ; tant que ce n'est
   pas fait, les pods d'instance posés sur ce nœud restent en `ImagePullBackOff`.
3. Contrôler : un pod `inst-*` démarre (pas d'`ImagePullBackOff` ni de `401`) et un `pull` anonyme sur `ctf/` est refusé.
4. Rotation : modifier le mot de passe à la main dans `secrets/credentials.sops.yaml`, dans la ligne htpasswd (bcrypt) de
   `gitops/platform/zot/secret.sops.yaml` et dans `gitops/apps/chall-manager/secret.sops.yaml` (`task secrets:init` ne réécrit jamais
   un fichier existant), puis rejouer l'étape 1 sur chaque nœud.

## 9. Clé cosign et passage en `enforce`

La vérification des signatures est en `audit` par défaut. Le passage en `enforce` est un geste explicite, une fois la clé publique
posée et les images signées (procédure détaillée : [Images signées](images-signees.md)) :

1. `cosign generate-key-pair` ; la clé privée va dans les secrets de la CI du dépôt de challenges, jamais dans ce dépôt.
2. Remplacer `cosign.pub` dans `gitops/platform/kyverno/policies/image-policy-configmap.yaml` par la clé publique.
3. Signer les images de challenge poussées dans Zot, lire les PolicyReports (aucune violation attendue).
4. Dans le même commit : `mode: enforce` dans `pad-image-policy` et `instances.image_verification: enforce` dans `infra/contracts.yaml`.
5. Retour arrière : `mode: audit`.

Tant que `cosign.pub` contient `CHANGEME`, le registre interne reste en audit même en `enforce`.

## 10. Protéger la branche `main`

ArgoCD synchronise `main` automatiquement : tout ce qui est fusionné dans `gitops/` ou `bootstrap/` s'exécute dans le cluster.
`.github/CODEOWNERS` ne protège rien tant que la protection de branche n'est pas activée, ce que seul le propriétaire du dépôt peut faire
(relecture obligatoire par les Code Owners, checks `ci.yml` requis, commits signés, pas de contournement ni de force-push).
Réglages exacts : [Protection de la branche main](protection-branche.md).

## 11. Générer les fichiers de verrouillage

Sur une machine qui a accès aux registries (OpenTofu, Nix), commiter :

```bash
task tofu:lock        # .terraform.lock.hcl multi-plateformes de chaque stack
nix flake lock        # flake.lock (ne pas le commiter depuis un worktree d'agent)
```

Sans eux, les versions ne sont épinglées que par la contrainte exacte des providers, pas par leur empreinte.

## 12. Autres vérifications du premier déploiement

| À faire | Pourquoi |
|---|---|
| Premier compte `ctf-admins` / `ctf-managers` dans Authentik | l'accès au portail manager exige le groupe (et le MFA du staff, action 3) |
| Vérifier la redirection OIDC de chaque application | le redirect URI doit correspondre à l'URL réelle |
| Renseigner `uptime_kuma_watchdog_token` | active le dead-man's switch ([Watchdog](../runbooks/watchdog.md)) |
| Vérifier `hostUsers: false` sur une instance | `kubectl -n inst-<id> get pod -o jsonpath='{.items[0].spec.hostUsers}'` puis `cat /proc/self/uid_map` dans le conteneur ; sinon `PAD_HOST_USERS=true` (échappatoire) ou RuntimeClass gVisor (`PAD_RUNTIME_CLASS`) |
| Vérifier le quota et le LimitRange d'une instance | `kubectl -n inst-<id> get resourcequota,limitrange` (générés par Kyverno) |
| Vérifier que les instances n'ont aucune sortie | depuis un pod d'instance, toute résolution DNS échoue (sauf `*.cluster.local` si `dns: cluster` a été demandé par un administrateur) |
| Vérifier les limites du pool challenges | `kubectl get node <worker> -o jsonpath='{.status.capacity.pods}'` = 40 ; fork bomb d'essai bornée à 256 PIDs. Un changement du patch Talos ne remplace pas les machines existantes : créer un nouveau `TalosConfigTemplate` (nouveau nom) et l'y référencer |
| Garage : clé de sauvegarde dédiée (facultatif) | `task secrets:init -- --all` à la création, ou ajouter `backup_access_key_id` / `backup_secret_access_key` à `secret-s3.sops.yaml` ; `scripts/backup.sh` et `restore.sh` s'en servent pour le bucket `backups` |
| Lancer `task backup` puis un test de restauration | disposer d'un point de reprise vérifié |
| Tester une alerte (arrêter un exporter) | confirmer que Discord et l'e-mail reçoivent |
| Vérifier que l'import de challenges accepte 50 Mio | corps maximal de l'ingress |
| `task load` hors événement | calibrer les seuils KEDA |

Chaque point validé sur le matériel réel doit être reporté dans [Limites connues](../reference/limites.md), qui liste ce qui
n'a pas encore été vérifié hors de l'environnement de développement.
