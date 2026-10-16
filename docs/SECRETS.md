# Secrets : SOPS + age, commités chiffrés

Le repo est public. Les secrets y sont **commités chiffrés** (SOPS + age) ; aucune valeur en clair, aucune clé privée.

| Consommateur | Mécanisme | Clé age utilisée |
|---|---|---|
| ArgoCD (Secrets Kubernetes) | ksops (générateur kustomize) dans le repo-server | clé du **cluster** (Secret `sops-age`) |
| Ansible | `community.sops.load_vars` | clé de l'**opérateur** |
| OpenTofu | provider `carlpett/sops` | clé de l'**opérateur** |
| scripts (`bootstrap/`, `backup.sh`) | `sops --decrypt` | clé de l'**opérateur** |

## Procédure opérateur (5 lignes)

1. `nix develop`, puis `task secrets:keys` : crée hors repo la clé opérateur (`~/.config/sops/age/keys.txt`) et la clé du cluster (`~/.config/pad/cluster.agekey`), renseigne les deux recipients de `.sops.yaml` (clés publiques, à commiter). **Sauvegarder les deux clés privées hors machine.**
2. `task secrets:init` : crée tous les `*.sops.yaml` manquants (secrets aléatoires forts générés ; jamais de réécriture d'un fichier existant) et affiche ce qui reste à renseigner.
3. Compléter les valeurs externes avec `sops <fichier>` (liste : `task secrets:pending`) : jeton Proxmox, OVH, webhook Discord, SMTP, PAT NetBird, etc.
4. `task secrets:check` : doit afficher `OK` (chaque example a son sops, aucun `CHANGEME`, rien en clair suivi par git). Commiter les `*.sops.yaml` et `.sops.yaml`.
5. `task up` : `bootstrap:gitops` injecte la clé du **cluster** (pas celle de l'opérateur) dans le Secret `sops-age` d'ArgoCD.

## Organisation des fichiers

- `secrets/<domaine>.example.yaml` (clés attendues, valeurs `CHANGEME`) → `secrets/<domaine>.sops.yaml` : secrets d'infra. Toutes les valeurs sont chiffrées ; recipient : opérateur seul.
- `gitops/**/<nom>.example.yaml` → `gitops/**/<nom>.sops.yaml` : Secrets Kubernetes, référencés par le `secret-generator.yaml` (ksops) de la kustomization du composant. Seuls `data`/`stringData` sont chiffrés ; recipients : opérateur + cluster. `*.example.yaml` n'est jamais appliqué.
- Secrets du socle : annotation `argocd.argoproj.io/sync-wave: "-8"` (après les namespaces à -10, avant les composants).
- `secrets/credentials.sops.yaml` (opérateur seul, créé par `init`) : mots de passe **en clair** des valeurs stockées hachées (Zot admin/pad-ci/pad-pull, root OPNsense), introuvables autrement : `sops -d --extract '["zot_pad_ci_password"]' secrets/credentials.sops.yaml`.
- Clé S3 Garage : `task secrets:init` génère une seule fois `access_key_id` (`GK` + 24 hex) et `secret_access_key` (64 hex) dans `gitops/platform/garage/secret-s3.sops.yaml` (Secret `garage-s3-credentials`) et les recopie à l'identique dans `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` de `gitops/apps/ctfd/secret.sops.yaml`. Le Job PostSync `garage-init` **importe** cette clé (`garage key import`, idempotent), crée les buckets `ctfd-uploads` et `backups` et ne lui donne que lecture/écriture sur eux ; il ne crée aucun Secret. `scripts/backup.sh` et `restore.sh` relisent `garage-s3-credentials`. **Clé de sauvegarde dédiée (facultative)** : `task secrets:init -- --all` ajoute aussi `backup_access_key_id` / `backup_secret_access_key` au même Secret ; le Job `garage-init` l'importe, ne lui donne accès qu'au bucket `backups` et retire à la clé de CTFd tout droit sur ce bucket (une compromission de CTFd ne permet plus de lire ni d'altérer les dumps MariaDB). `backup.sh` et `restore.sh` l'utilisent alors pour `backups` (clé principale pour `ctfd-uploads`), et se replient sur la clé principale quand elle est absente. Elle ne se crée qu'à la génération du fichier (un `secret-s3.sops.yaml` existant n'est jamais réécrit) : sur un fichier existant, ajouter les deux clés à la main (`GK` + 24 hex, 64 hex). Rotation : changer les deux fichiers sops avec les mêmes valeurs puis supprimer l'ancienne clé dans Garage (`garage key delete`).
- Valeurs partagées générées **une seule fois** et recopiées : `PAD_SSO_SHARED_SECRET` (CTFd = frontend), `PAD_INTERNAL_TOKEN` (CTFd = netbird-sync, lecture des membres d'équipe), mot de passe Valkey (Valkey = `REDIS_PASSWORD` CTFd = `VALKEY_URL` frontend), mot de passe `metrics` de Zot, `pad-pull` Zot (= `chall-manager-oci`), `bootstrap_token` Authentik (= `authentik-tofu`).
- Nouvelle app avec un secret : ajouter `secret.example.yaml` + `secret-generator.yaml` + `generators:` dans sa kustomization ; sans règle dans `HANDLERS` de `scripts/sopsctl.py`, `init` chiffre l'exemple tel quel (tout reste `CHANGEME` à renseigner).

## Valeurs de site

`secrets/site.sops.yaml` (modèle `secrets/site.example.yaml`, valeurs vides) porte les valeurs propres à l'hôte : URL de l'API Proxmox, adresse et utilisateur SSH, IP publique, passerelle, MAC. Il est lu par tofu, Ansible et les scripts ; `task secrets:pending` en liste les clés encore vides. Détails : [Valeurs de site](reference/site.md).

## Valeurs à fournir après `init` (jamais générables)

`secrets/site` (valeurs de site), `secrets/{proxmox,ovh,edge}` (jetons Proxmox/OVH), `monitoring` (Discord, SMTP, Kuma), `authentik.bootstrap_email`, `netbird-tofu` et `warpgate-tofu` (PAT créés après le premier déploiement), `github-deploy-key` (si `ssh-keygen` absent à l'init), `gitops/platform/{external-dns,cert-manager,proxmox-csi}`, `gitops/apps/netbird-sync` (`NETBIRD_API_URL`, `NETBIRD_API_TOKEN` ; `PAD_INTERNAL_TOKEN` est déjà recopié), `frontend` (`NETBIRD_API_TOKEN` : PAT de l'utilisateur `pad-frontend-readonly`, rôle `auditor`, jamais celui de `netbird-sync`), `authentik-tofu` (clés du captcha). Le secret facultatif `secrets/backup-s3` n'est créé qu'avec `task secrets:init -- --all`.

## Secrets des clients OIDC (générés par tofu)

Les secrets des clients OIDC (`netbird_server_authentik_client_secret`, `warpgate_sso_client_secret`, `grafana_oidc_client_secret`, `AUTH_AUTHENTIK_SECRET` du front) ne se génèrent **pas** avec `task secrets:init` : ce sont des `random_password` de la stack `30-authentik`
(sortie sensible `oidc_client_secrets`), qui n'existe qu'une fois Authentik déployé. Ils restent à `CHANGEME` jusqu'à `task secrets:oidc-sync`
(`python3 scripts/sopsctl.py oidc-sync`), qui lit la sortie `tofu output -json oidc_client_secrets`, la déchiffre en mémoire et recopie chaque valeur dans le sops concerné (aucune valeur n'est affichée ni écrite en clair).
`task up` l'exécute pour vous entre `30-authentik` et la seconde passe d'Ansible (voir [Up](runbooks/up.md)) ; la commande est idempotente et sert aussi après une rotation.
Le secret d'ArgoCD suit le même chemin : `oidc-sync` renseigne `clientSecret` dans `gitops/platform/argocd/secret-oidc.sops.yaml` (Secret `argocd-oidc`, label `app.kubernetes.io/part-of: argocd`), déchiffré par ksops et appliqué par l'Application `root` (le chart argo-cd ne le crée pas). Reste manuel : `proxmox` (realm OpenID).

## CI publique : jamais d'accès à la vraie clé

`kustomize build` exige les `secret.sops.yaml`, que seul l'opérateur peut produire. `scripts/validate-gitops.sh` (CI et `task lint`) travaille sur une **copie temporaire** de `gitops/` : il supprime tout `*.sops.yaml`, génère une clé age **éphémère**, chiffre chaque `*.example.yaml` avec elle, puis lance `kustomize build` (ksops) et `kubeconform`. Les vrais fichiers ne sont ni lus ni modifiés ; la clé éphémère disparaît en sortie. Seule la forme des manifestes est validée (valeurs `CHANGEME`).

Garde-fous sans clé (CI `secrets-guard`, `task lint`, pre-commit) : `scripts/check-sops.sh` exige dans tout `*.sops.*` un bloc `sops:` complet (recipient age, mac), aucune valeur hors `ENC[...]` (dans `data`/`stringData` pour gitops et les Secret, partout ailleurs), aucun recipient `CHANGEME`, aucun `keys.txt`/`*.agekey`/`*.decrypted.*`/`*.dec.yaml`/clé `AGE-SECRET-KEY-` suivi, aucun `kind: Secret` en clair. gitleaks (`.gitleaks.toml`) garde toutes ses règles ; seules les lignes `ENC[AES256_GCM,...]` des `*.sops.*` et les lignes `CHANGEME` des `*.example.yaml` sont ignorées.

Pre-commit facultatif : `ln -s ../../scripts/check-sops.sh .git/hooks/pre-commit` (ou l'appeler depuis votre outil de hooks).

## Recipients, rotation

- Ajouter un opérateur : ajouter sa clé publique sous `keys:` dans `.sops.yaml`, la lister dans les règles, puis `task secrets:update-keys` (`sops updatekeys` sur chaque fichier) ; commiter.
- Cluster déjà déployé sans sa clé comme recipient : `task secrets:keys` (renseigne `.sops.yaml`), `task secrets:update-keys`, commiter, puis `task bootstrap:gitops` (recrée `sops-age`).
- `task secrets:rotate-cluster-key` : nouvelle clé cluster, recipient remplacé, `updatekeys` + `sops rotate` (nouvelle clé de données) sur `gitops/**`, ancienne clé conservée en `*.old`. Ensuite : commiter, `task bootstrap:gitops`, détruire l'ancienne clé. Si l'ancienne clé a fuité, changer aussi les valeurs : l'historique Git contient l'ancien chiffrement.
- La clé du cluster ne déchiffre **que** `gitops/**` : jetons Proxmox, OVH, etc. (`secrets/`) restent hors du cluster.

## Dépannage

- Sync ArgoCD en erreur `ksops` / `no identity matched` : Secret `sops-age` absent ou clé cluster non recipient du fichier (`task secrets:update-keys`).
- `kustomize build` local : `SOPS_AGE_KEY_FILE=~/.config/pad/cluster.agekey XDG_CONFIG_HOME=/nonexistent kustomize build --enable-alpha-plugins --enable-exec gitops/apps/ctfd` (nécessite `ksops` dans le `PATH`) ; ou simplement `task secrets:validate-gitops`.
- Variable `PAD_SOPS_CONFIG` : chemin d'un `.sops.yaml` alternatif (tests), `PAD_CLUSTER_AGE_KEY_FILE` : emplacement de la clé cluster.
