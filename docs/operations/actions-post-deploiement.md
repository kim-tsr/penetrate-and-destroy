# Actions manuelles après déploiement

`task up` automatise tout ce que les API permettent. Il reste quelques actions qui exigent un geste humain, soit
parce que le fournisseur OpenTofu ne sait pas les faire, soit parce qu'un secret n'existe qu'après le premier
déploiement. **Les faire avant d'ouvrir la plateforme aux joueurs.**

!!! warning "Ordre"
    Les actions 1 à 3 conditionnent la sécurité du réseau. Sans elles, soit tout le monde atteint tout (action 1),
    soit personne n'atteint rien (actions 2 et 3).

## 1. Supprimer la policy NetBird « Default »

À l'initialisation, NetBird crée une policy **Default** qui autorise tous les pairs à joindre tous les pairs
(`All` vers `All`). Elle annule le « deny all » voulu : un joueur connecté verrait le staff et toutes les instances.

1. Ouvrir le dashboard NetBird (`https://vpn.example.net`), **Access Control > Policies**.
2. Désactiver, puis supprimer la policy **Default**.
3. Vérifier qu'il ne reste que : `staff-vers-bastion` (stack `40-netbird`) et les policies `pad-inst-*` créées par
   `netbird-sync`.

Le provider OpenTofu ne modélise pas le groupe « All » : cette action n'est pas automatisable aujourd'hui.

## 2. Créer le PAT de `netbird-sync`

Le provider NetBird ne sait créer un jeton que pour l'utilisateur courant. Le jeton de l'utilisateur de service
`netbird-sync` (créé par la stack `40-netbird`) se crée à la main :

1. Dashboard NetBird, **Team > Service Users**, utilisateur `netbird-sync`, **Create token**.
2. Reporter la valeur dans le secret SOPS de `gitops/apps/netbird-sync` (clé `NETBIRD_API_TOKEN`) :
   `sops gitops/apps/netbird-sync/secret.sops.yaml`.
3. `NETBIRD_API_URL` correspond à la sortie `management_url` de la stack `40-netbird`.
4. Commiter et pousser ; ArgoCD déploie. Contrôler : `kubectl -n netbird-sync logs deploy/netbird-sync` sans erreur
   401/403.

Sans ce jeton, aucune instance n'est joignable : voir [netbird-sync](../runbooks/netbird-sync.md).

Il faut aussi, une fois NetBird déployé, **un PAT administrateur** pour la stack `40-netbird`
(`secrets/netbird-tofu.sops.yaml`, clé `api_token`) et pour l'amorçage en deux passes du rôle Ansible
(`secrets/netbird.sops.yaml`, `netbird_server_api_token`). Le jeton de Warpgate pour la stack `50-warpgate` suit le même
principe (`secrets/warpgate-tofu.sops.yaml`).

## 3. Règles OPNsense des routing peers

NetBird route le trafic des joueurs par un **routing peer** en masquerade : les cibles voient l'IP du routing peer.
Deux routing peers existent (un par zone) et OPNsense doit les autoriser explicitement :

| Peer | IP | Doit pouvoir joindre | Ports |
|---|---|---|---|
| challenges | `10.20.70.10` | les IP d'instances (pool `10.20.70.100` à `.199`), dans la même zone CHALLENGES | ports des instances |
| bastion (LXC `warpgate`) | `10.20.30.10` | les cibles du bastion | selon les targets Warpgate |

Pour le peer `challenges`, le trafic reste dans la zone CHALLENGES ; vérifier qu'aucune règle de l'interface n'interdit
le flux intra-zone, et que la règle `CHALLENGES vers rien` n'inclut pas la destination des instances. Ces règles ne
sont pas encore dans la stack `60-opnsense-rules` : les ajouter (de préférence dans le code, puis
`task tofu:apply-stack STACK=60-opnsense-rules`) et noter ce que vous avez fait.

Test : depuis un poste NetBird d'un joueur, une instance démarrée doit répondre ; sans NetBird, elle ne doit pas répondre.

## 4. Générer les fichiers de verrouillage

Sur une machine qui a accès aux registries (OpenTofu, Nix), commiter :

```bash
task tofu:lock        # .terraform.lock.hcl multi-plateformes de chaque stack
nix flake lock        # flake.lock (ne pas le commiter depuis un worktree d'agent)
```

Sans eux, les versions ne sont épinglées que par la contrainte exacte des providers, pas par leur empreinte.

## 5. Autres vérifications du premier déploiement

| À faire | Pourquoi |
|---|---|
| Premier compte `ctf-admins` / `ctf-managers` dans Authentik | l'accès au portail manager exige le groupe |
| Vérifier la redirection OIDC de chaque application | le redirect URI doit correspondre à l'URL réelle |
| Renseigner `uptime_kuma_watchdog_token` | active le dead-man's switch ([Watchdog](../runbooks/watchdog.md)) |
| Passer `verify-images` en `Enforce` | après renseignement de la clé publique cosign et signature des images |
| Lancer `task backup` puis un test de restauration | disposer d'un point de reprise vérifié |
| Tester une alerte (arrêter un exporter) | confirmer que Discord et l'e-mail reçoivent |
| Vérifier que l'import de challenges accepte 50 Mio | corps maximal de l'ingress |
| `task load` hors événement | calibrer les seuils KEDA |

Chaque point validé sur le matériel réel doit être reporté dans [Limites connues](../reference/limites.md), qui liste ce qui
n'a pas encore été vérifié hors de l'environnement de développement.
