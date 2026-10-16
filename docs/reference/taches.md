# Tâches `task`

Tout passe par [Task](https://taskfile.dev) (Taskfile racine, qui inclut `infra/tofu`, `infra/ansible`, `bootstrap`,
`apps`, `scripts/Taskfile.secrets.yml` et `scripts/Taskfile.docs.yml`). `task --list-all` affiche la liste à jour ; cette page la
décrit. Le parcours complet, pas à pas : [Guide de déploiement](../guide-deploiement.md).

## Déploiement par phases

`task up` enchaîne les phases 0 à 12. Chaque `phase:*` fait son action, puis lance sa vérification (lecture seule, `OK`/`KO`/`WARN`) et consigne sa réussite pour `task status`.
`PAD_CHECK_MODE=warn` empêche un `KO` de bloquer l'enchaînement.

| Tâche | Effet |
|---|---|
| `up` | phases 0 à 12 dans l'ordre (idempotent, reprenable) |
| `phase:0-prereqs` | outils, clés age, secrets, SSH et API Proxmox, privilèges du jeton, stockages (dont point de montage du dataset ZFS des VM) |
| `phase:1-reseau` | `00-host-network` puis `ansible:host` |
| `phase:2-routeur` | `10-router`, attente d'OPNsense, `host:route`, `60-opnsense-rules` |
| `phase:3-image-talos` | `15-talos-image` (template Talos) |
| `phase:4-lxc` | `20-services-lxc` (six LXC, inventaire Ansible) |
| `phase:5-dns` | `70-dns` (A publics) |
| `phase:6-services-1` | Ansible : monitoring, authentik, edge |
| `phase:7-identite` | `30-authentik` puis `secrets:oidc-sync` |
| `phase:8-services-2` | Ansible : monitoring, warpgate, netbird |
| `phase:9-cluster` | `bootstrap:cluster` (kind, CAPI, VMs Talos, pivot) |
| `phase:10-gitops` | contrôle « tout est poussé », `bootstrap:gitops` |
| `phase:11-acces` | contrôle des jetons, Ansible netbird, `40-netbird`, `netbird:sync-keys`, `netbird:agents` (routing peers), `50-warpgate` |
| `netbird:sync-keys` | setup keys de `40-netbird` vers `secrets/netbird-agent.sops.yaml` |
| `netbird:agents` | `/dev/net/tun` (hôte) puis agents NetBird de `nbrouter` et `warpgate` |
| `netbird:rotate-keys` | recrée les setup keys, les recopie, rejoue les agents |
| `phase:12-verify` | smoke tests et rappel des actions manuelles |
| `check:0-prereqs` … `check:12-verify` | la vérification d'une phase, seule |
| `check:cluster-detruit`, `check:tout-detruit` | contrôles après destruction |
| `status` | quelles phases semblent faites (hors ligne) ; `task status -- --live` rejoue les vérifications |
| `plan:<stack>` | `tofu plan` d'une stack (`plan:00-host-network`, `plan:10-router`, `plan:15-talos-image`, `plan:20-services-lxc`, `plan:30-authentik`, `plan:40-netbird`, `plan:50-warpgate`, `plan:60-opnsense-rules`, `plan:70-dns`) |
| `host:route` | rejoue le rôle `host-tuning` (tag `host_route`) : route de l'hôte vers les zones via OPNsense, permanente et idempotente (déjà jouée par la phase 2) |
| `host:lxc-features` | rejoue le rôle `host-tuning` (tag `host_lxc_features`) : `keyctl` sur les LXC de services, réservé à `root@pam` côté API (déjà jouée par la phase 4) |
| `verify` | smoke tests (`scripts/verify.sh`) |

## Destruction et reconstruction

Toutes passent par `scripts/confirm-destroy.sh` (taper `destroy`, ou `PAD_CONFIRM_DESTROY=destroy`). Voir [Détruire, reconstruire](../guide-deploiement.md).

| Tâche | Effet |
|---|---|
| `cluster:destroy` | cluster seul : pivot inverse vers kind, suppression des VMs par Cluster API |
| `cluster:destroy-force` | cluster cassé : suppression directe des VMs par tag via l'API Proxmox |
| `cluster:rebuild` | `cluster:destroy` puis phases 9 et 10 |
| `destroy` | tout sauf l'hôte, en ordre inverse : [runbook](../runbooks/destroy.md) |
| `rebuild` | `destroy` puis `up`, chronométré : [runbook](../runbooks/rebuild.md) |
| `state:purge` | efface l'état local après destruction (`-- --force`, `-- --backups`) |

## Valeurs de site, sauvegardes, tests, documentation

| Tâche | Effet |
|---|---|
| `site:set -- cle=valeur…` | valeurs non secrètes à mettre dans le dépôt (`node`, `datastore_vm`, `datastore_vm_type`, `datastore_iso`, `domain`, `acme_email`, `git_repo`, `git_ssh`, `dns_zone`, `zones_bridge`, `transit_bridge`, `wan_mode`) : contrat + manifests marqués (`zones_bridge`/`transit_bridge` : à changer si l'hôte utilise déjà `vmbr2`/`vmbr1`, la phase 0 refuse un pont déjà utilisé) ; `-- --show` |
| `site:node -- <nom>` | alias de `site:set -- node=<nom>` |
| `backup` / `restore` | MariaDB + Garage : [runbook](../runbooks/backup-restore.md) |
| `e2e` | pile e2e locale (docker compose) et smoke tests ; `task e2e -- down` l'arrête |
| `load` | test de charge k6 (`PAD_PROFILE=smoke`, `load`, `stress`) |
| `lint` | toutes les vérifications statiques, identiques à la CI (`scripts/lint.sh`) |
| `docs:serve`, `docs:build`, `docs:venv` | aperçu local sur `http://127.0.0.1:8000`, build strict, venv de la documentation |

## OpenTofu (`task tofu:...`)

| Tâche | Effet |
|---|---|
| `tofu:apply-stack STACK=<nom>` | `init` + `apply` d'une stack |
| `tofu:plan-stack STACK=<nom>` | `init` + `plan` |
| `tofu:destroy-stack STACK=<nom> [MODE=tolerant]` | `destroy` ; ignoré sans state ; `tolerant` met le state de côté si l'API du service a disparu |
| `tofu:apply-netbird`, `tofu:apply-warpgate` | applique `40-netbird` et `50-warpgate` (jetons requis) |
| `tofu:fmt`, `tofu:validate-all` | formatage, `fmt -check` + `validate` sans accès serveur |
| `tofu:lock` | régénère les `.terraform.lock.hcl` multi-plateformes |

Stacks : `00-host-network`, `10-router`, `15-talos-image`, `20-services-lxc`, `30-authentik`, `40-netbird`,
`50-warpgate`, `60-opnsense-rules`, `70-dns`.

## Ansible (`task ansible:...`)

| Tâche | Effet |
|---|---|
| `ansible:deps` | installe les collections épinglées |
| `ansible:host` | configure l'hôte Proxmox (inventaire d'exemple tant que les LXC n'existent pas) |
| `ansible:services` | déploie edge, netbird, warpgate, authentik, monitoring (`-- --tags …`, `-- --limit …`) |
| `ansible:syntax`, `ansible:lint` | contrôles sans contact avec le serveur |

## Bootstrap (`task bootstrap:...`)

| Tâche | Effet |
|---|---|
| `bootstrap:cluster` | `kind` éphémère, Cluster API, `pad-prod`, Cilium, pivot (reprenable) |
| `bootstrap:gitops` | ArgoCD, Secret `sops-age`, Secret du dépôt, Application `root` |
| `bootstrap:destroy` | pivot inverse et suppression du cluster (utilisé par `cluster:destroy` et `destroy`) |
| `bootstrap:kubeconfig` | affiche `KUBECONFIG` / `TALOSCONFIG` (régénère si absents) |
| `bootstrap:render-providers` | rend les manifestes des providers CAPI depuis le contrat |

## Applications (`task apps:...`)

| Tâche | Effet |
|---|---|
| `apps:pin-digests -- [tag]` | épingle dans les manifests les empreintes des images publiées sur ghcr (tag = sha court, défaut HEAD) : [Images signées](../operations/images-signees.md) |
| `apps:zot:publish -- [tag]` | publie dans Zot le scénario chall-manager (OCI, `oras`) et copie les images de challenge de ghcr vers `registry.pad.internal/ctf/` (même empreinte) ; après la phase 10 : [Guide, phase 11](../guide-deploiement.md) |
| `apps:build`, `apps:push`, `apps:sign` | construit / pousse / pousse et signe (cosign) les images |
| `apps:build:ctfd`, `:frontend`, `:netbird-sync`, `:chall-manager-scenario` | image d'un composant |
| `apps:build:chal-pwn-ret2win-instanced`, `:chal-web-sqli-instanced` | images des exemples de challenges |

## Secrets (`task secrets:...`)

| Tâche | Effet |
|---|---|
| `secrets:keys` | génère les clés age opérateur et cluster (hors dépôt) et renseigne `.sops.yaml` |
| `secrets:init` | crée les `*.sops.yaml` manquants depuis les `*.example.yaml` (jamais de réécriture) |
| `secrets:pending` | liste les valeurs encore à `CHANGEME` (noms de clés uniquement) |
| `secrets:check` | examples/sops cohérents, aucun `CHANGEME`, aucune clé en clair suivie |
| `secrets:check-structure` | garde-fou sans clé (identique à la CI) |
| `secrets:update-keys` | applique les recipients de `.sops.yaml` à tous les fichiers |
| `secrets:rotate-cluster-key` | rotation de la clé du cluster ([runbook](../runbooks/rotation-secrets.md)) |
| `secrets:validate-gitops` | `kustomize build` + `kubeconform` avec des sops factices |

## Validations par zone

| Zone | Commande |
|---|---|
| tout | `bash scripts/lint.sh` (`PAD_LINT_FULL=1` ajoute le harnais pytest CTFd) |
| secrets | `bash scripts/check-sops.sh`, `task secrets:check` |
| gitops | `bash scripts/validate-gitops.sh` |
| tofu | `tofu fmt -check -recursive`, `tofu init -backend=false && tofu validate` par stack |
| ansible | `ansible-lint` (profil production) |
| monitoring | `bash monitoring/scripts/check.sh` |
| CTFd | `bash apps/ctfd/scripts/test.sh` |
| Go | `go test ./...` dans `apps/netbird-sync` et `apps/chall-manager-scenario` |
| front | `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, puis Playwright en mode mock (`PAD_MOCK=1`) |
| documentation | `pip install -r docs/requirements.txt && mkdocs build --strict` |

## Construire la documentation

```bash
python3 -m venv .venv-docs && . .venv-docs/bin/activate
pip install -r docs/requirements.txt
mkdocs serve                 # http://127.0.0.1:8000, rechargement automatique
mkdocs build --strict        # échoue sur un lien cassé (comme la CI)
```
