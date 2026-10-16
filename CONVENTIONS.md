# Conventions du repo (à respecter par tous les contributeurs et agents)

## Sources de vérité
- `infra/contracts.yaml` : IPs, CIDR, VLAN, VMIDs, noms DNS, groupes IdP, client_ids OIDC, ports, namespaces.
  - tofu : `yamldecode(file("${path.root}/../../contracts.yaml"))` (local `c`).
  - ansible : `vars_files: ../contracts.yaml` (via `group_vars/all/contracts.yml` qui fait un lookup).
  - gitops : valeurs recopiées dans les manifests, avec commentaire `# contracts: <chemin.yaml>`. Un script `scripts/lint.sh` vérifie la cohérence des IPs clés.
- Ne jamais inventer une IP ou un nom hors de ce fichier ; s'il manque une valeur, l'ajouter au fichier.
- Valeurs propres au site (URL de l'API Proxmox, accès SSH à l'hôte, IP publique, passerelle, MAC) : jamais dans le contrat ni dans Git en clair ; `secrets/site.sops.yaml` (modèle `secrets/site.example.yaml`).

## Secrets
- SOPS + age uniquement. Fichiers `*.sops.yaml`. Jamais de secret en clair, même d'exemple réaliste.
- Secrets d'infra : `secrets/<domaine>.sops.yaml` (ex : `secrets/proxmox.sops.yaml`, `secrets/authentik.sops.yaml`).
  Fournir à côté un `secrets/<domaine>.example.yaml` (non chiffré, valeurs `CHANGEME`) documentant les clés attendues.
- Kubernetes : `Secret` chiffrés SOPS dans gitops, déchiffrés par ksops (plugin kustomize d'ArgoCD).
- Chaque `*.example.yaml` a son `*.sops.yaml` (`task secrets:init`) ; un `secret-generator.yaml` ksops dans la kustomization du composant.
  Procédure, CI (sops factices à clé éphémère) et rotation : `docs/SECRETS.md`. Clé privée age jamais dans le repo.

## Versions et reproductibilité
- Tout est épinglé : providers tofu (`required_providers` avec version exacte + `.terraform.lock.hcl` commité),
  charts Helm (version exacte), images (`tag@sha256:digest` quand l'image tourne en prod), collections Ansible (`requirements.yml` versions exactes).
- Dockerfiles : base épinglée par digest, `ARG SOURCE_DATE_EPOCH`, pas de `apt-get upgrade`, `--no-install-recommends`, utilisateur non-root.
- Renovate maintient les versions (`renovate.json`).

## Style
- OpenTofu >= 1.10, `tofu fmt`. Un stack = un state, state chiffré (bloc `encryption` avec `pbkdf2` sur `TF_VAR_state_passphrase`), backend local `.state/tofu/<stack>.tfstate`.
- Ansible : rôles idempotents, `ansible-lint` profil `production`, FQCN, handlers.
- Kubernetes : kustomize ; Helm via ArgoCD `Application` multi-source (chart + values du repo). Labels `app.kubernetes.io/*`, `pad.io/zone`.
- Chaque composant a `requests/limits`, `securityContext` restrictif (runAsNonRoot, readOnlyRootFilesystem si possible, drop ALL), probes, `PodDisruptionBudget` si >1 replica, `NetworkPolicy` default-deny + allow explicites.
- Chaque composant expose des métriques (ServiceMonitor/PodMonitor ou scrape Alloy) et des logs JSON.
- Commentaires et docs en français ; identifiants en anglais.

## Commandes
- Tout passe par `task` (Taskfile racine qui inclut `infra/tofu`, `infra/ansible`, `bootstrap`, `apps`).
- Les tâches attendues par le Taskfile racine : `tofu:apply-stack`, `tofu:destroy-stack`, `ansible:host`, `ansible:services`,
  `bootstrap:cluster`, `bootstrap:gitops`, `bootstrap:destroy`, `apps:build`.

## Interdits
- Pas de `kubectl apply` manuel hors `bootstrap/` (après bootstrap, tout passe par ArgoCD).
- Pas d'action sur le serveur réel pendant le développement : seulement `validate`, `plan` avec des variables factices, lint, build local.
