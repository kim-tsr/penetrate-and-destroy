# Tâches `task`

Tout passe par [Task](https://taskfile.dev) (Taskfile racine, qui inclut `infra/tofu`, `infra/ansible`, `bootstrap`,
`apps` et `scripts/Taskfile.secrets.yml`). `task --list` affiche la liste à jour.

## Orchestration

| Tâche | Effet |
|---|---|
| `task up` | reconstruit toute la plateforme (idempotent) : [runbook](../runbooks/up.md) |
| `task destroy` | supprime tout sauf l'hôte, avec confirmation forte : [runbook](../runbooks/destroy.md) |
| `task rebuild` | `destroy` puis `up`, chronométré : [runbook](../runbooks/rebuild.md) |
| `task verify` | smoke tests post-déploiement (endpoints, SSO, ArgoCD, isolement) |
| `task backup` / `task restore` | MariaDB + Garage : [runbook](../runbooks/backup-restore.md) |
| `task e2e` | pile e2e locale (docker compose) et smoke tests ; `task e2e -- down` l'arrête |
| `task load` | test de charge k6 (`PAD_PROFILE=smoke`, `load`, `stress`) |
| `task lint` | toutes les vérifications statiques, identiques à la CI (`scripts/lint.sh`) |
| `task site:node -- <nom>` | nom du nœud Proxmox si différent de `pve` : met à jour le contrat et les manifests gitops marqués `# contracts: host.node` |

## OpenTofu (`task tofu:...`)

| Tâche | Effet |
|---|---|
| `tofu:apply-stack STACK=<nom>` | `init` + `apply` d'une stack |
| `tofu:plan-stack STACK=<nom>` | `init` + `plan` |
| `tofu:destroy-stack STACK=<nom>` | `destroy` (ignoré sans state) |
| `tofu:apply-netbird`, `tofu:apply-warpgate` | applique `40-netbird` et `50-warpgate` (jetons requis) |
| `tofu:fmt`, `tofu:validate-all` | formatage, `fmt -check` + `validate` sans accès serveur |
| `tofu:lock` | régénère les `.terraform.lock.hcl` multi-plateformes |

Stacks : `00-host-network`, `10-router`, `15-talos-image`, `20-services-lxc`, `30-authentik`, `40-netbird`,
`50-warpgate`, `60-opnsense-rules`, `70-dns`.

## Ansible (`task ansible:...`)

| Tâche | Effet |
|---|---|
| `ansible:deps` | installe les collections épinglées |
| `ansible:host` | configure l'hôte Proxmox (ARC ZFS, sysctl, DNAT de repli, exporters, Alloy) |
| `ansible:services` | déploie edge, netbird, warpgate, authentik, monitoring |
| `ansible:syntax`, `ansible:lint` | contrôles sans contact avec le serveur |

## Bootstrap (`task bootstrap:...`)

| Tâche | Effet |
|---|---|
| `bootstrap:cluster` | `kind` éphémère, Cluster API, `pad-prod`, Cilium, pivot (reprenable) |
| `bootstrap:gitops` | ArgoCD, Secret `sops-age`, Secret du dépôt, Application `root` |
| `bootstrap:destroy` | pivot inverse et suppression du cluster |
| `bootstrap:kubeconfig` | affiche `KUBECONFIG` / `TALOSCONFIG` (régénère si absents) |
| `bootstrap:render-providers` | rend les manifestes des providers CAPI depuis le contrat |

## Applications (`task apps:...`)

| Tâche | Effet |
|---|---|
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
