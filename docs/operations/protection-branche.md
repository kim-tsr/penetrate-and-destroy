# Protection de la branche `main` (à activer par l'opérateur)

ArgoCD synchronise `main` automatiquement (`syncPolicy.automated`). Tout ce qui est fusionné dans `gitops/` ou
`bootstrap/` s'exécute donc dans le cluster, et l'AppProject `apps` autorise des `ClusterRole` et
`ClusterRoleBinding` (un AppProject filtre par groupe et par kind, pas par nom). Sans relecture obligatoire, une
seule PR peut donc se donner `cluster-admin`. Le fichier `.github/CODEOWNERS` désigne les relecteurs ; **il ne
protège rien tant que la protection de branche n'est pas activée**, ce que seul le propriétaire du dépôt peut faire.

## Réglages recommandés (GitHub, Settings > Branches > règle sur `main`)

- Require a pull request before merging, avec au moins 1 approbation.
- Require review from Code Owners (active `.github/CODEOWNERS`).
- Dismiss stale pull request approvals when new commits are pushed.
- Require status checks to pass : les jobs de `ci.yml` (lint, gitops, tofu, ansible, tests).
- Require signed commits.
- Require branches to be up to date before merging.
- Do not allow bypassing the above settings (y compris pour les administrateurs), et interdire les force-push et la
  suppression de la branche.

## Compléments côté ArgoCD

- Épingler des clés GPG dans les AppProjects (`spec.signatureKeys`) pour que les Applications refusent un commit non
  signé. Ces clés sont des données du site : à ajouter par l'opérateur, pas dans le dépôt public.
- Toute PR qui touche `rbac.yaml`, `gitops/bootstrap/root.yaml` ou un `ClusterRoleBinding` se relit comme un changement
  de privilèges.
- `kustomize.buildOptions: --enable-exec` est nécessaire à ksops ; il exécute des binaires déclarés par le dépôt, ce
  qui rend la relecture des `kustomization.yaml` et `secret-generator.yaml` obligatoire.
