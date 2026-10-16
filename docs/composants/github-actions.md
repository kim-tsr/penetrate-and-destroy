# GitHub Actions

**Couche** : Outillage et CI · **Où** : runners GitHub (ubuntu-24.04) · **Version** : actions épinglées par SHA de commit

## À quoi elle sert ici et pourquoi ce choix

Tout changement est validé comme en local (`task lint`) : tofu (`fmt`, `validate`), ansible-lint, gitops (`kustomize build` avec sops factices + kubeconform), tests CTFd/Go/front, Playwright, e2e `docker compose`,
`k6 inspect`, shellcheck, Trivy, gitleaks, checkov, `check-sops` et `check-site-leaks`. Les images sont construites, signées et scannées ; la documentation est construite en `--strict`.

## Où elle tourne et comment elle est déployée

Trois workflows dans `.github/workflows/` : `ci.yml` (par chemins modifiés), `images.yml` (build, push, cosign, Trivy sur `main` et tags `v*`), `docs.yml` (`mkdocs build --strict` ; déploiement GitHub Pages facultatif, variable `PAD_DOCS_DEPLOY`).

## Version épinglée

Chaque action est épinglée par SHA avec le tag en commentaire (par exemple `actions/checkout`, `cachix/install-nix-action`, `docker/setup-buildx-action`) ; Dependabot et Renovate les maintiennent ([page](renovate-dependabot.md)).

## Fichiers de configuration dans le dépôt

`.github/workflows/ci.yml`, `images.yml`, `docs.yml`, `.github/dependabot.yml`, `.gitleaks.toml`.

## Interactions avec les autres briques

Exécute les outils du [devshell Nix](nix.md) ; publie vers GHCR et signe avec [cosign](cosign-trivy.md) ; la doc est construite avec [MkDocs](mkdocs.md).

## Sécurité

`permissions: {}` par défaut, permissions minimales par job (`id-token: write` seulement pour la signature keyless) ; `persist-credentials: false` ; aucune vraie clé : la CI valide avec des secrets factices.

## Supervision

Statut des workflows sur GitHub. Un échec de `docs.yml` ou de la CI bloque la fusion.

## Opérations courantes

```bash
bash scripts/lint.sh                  # équivalent local de la CI (PAD_LINT_FULL=1 pour le harnais CTFd)
bash scripts/check-sops.sh && bash scripts/check-site-leaks.sh
```

## Pièges connus

- `check-site-leaks.sh` ne stocke que des empreintes sha256 : ne jamais écrire un motif interdit en clair.
- Le job `docs` vérifie aussi qu'il existe un runbook par alerte (`monitoring/scripts/validate.py runbooks`).

## Documentation officielle

[docs.github.com/actions](https://docs.github.com/actions)

[Retour à l'index des composants](index.md){ .md-button }
