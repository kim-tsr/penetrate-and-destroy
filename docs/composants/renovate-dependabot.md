# Renovate et Dependabot

**Couche** : Outillage et CI · **Où** : services SaaS (propositions de PR) · **Version** : configuration `renovate.json` ; `.github/dependabot.yml`

## À quoi elle sert ici et pourquoi ce choix

Tout est épinglé exactement (providers, charts, collections, images par digest, actions par SHA) : sans automatisation, ces versions pourriraient. **Renovate** propose les mises à jour des charts, images,
providers, collections et digests ; **Dependabot** surveille les actions GitHub (hebdomadaire).

## Où elle tourne et comment elle est déployée

Applications GitHub (Renovate et Dependabot) ; elles ouvrent des PR que la CI valide. Aucune installation dans le dépôt hors fichiers de configuration.

## Version épinglée

Preset Renovate `config:recommended` + `:pinDigests` ; Dependabot : écosystème `github-actions`, intervalle hebdomadaire, préfixe de commit `ci`.

## Fichiers de configuration dans le dépôt

- `renovate.json` : gestionnaires `argocd` et `kubernetes` appliqués à `gitops/**`, mises à jour **majeures** soumises à approbation (tableau de bord).
- `.github/dependabot.yml`.
- Couples `tag@sha256` : `infra/ansible/inventories/prod/group_vars/all/versions.yml` (commentaire explicite sur `:pinDigests`).

## Interactions avec les autres briques

Ouvre des PR qui déclenchent [GitHub Actions](github-actions.md) ; touche les versions décrites dans toutes les pages de ce chapitre.

## Sécurité

Les majeurs exigent une approbation humaine ; les digests sont vérifiés par la CI ; le contrat de versions (`infra/contracts.yaml`) est la source pour les providers CAPI et Talos.

## Supervision

Tableau de bord Renovate dans les issues du dépôt ; PR en attente.

## Opérations courantes

Revue d'une PR de montée : lire les notes de version, relancer `bash scripts/lint.sh`, puis `task bootstrap:render-providers` si la version d'un provider CAPI change.

## Pièges connus

Une montée de chart ou de provider peut exiger une action coordonnée (ex. Authentik serveur et provider tofu, Talos et template de VM).

## Documentation officielle

[docs.renovatebot.com](https://docs.renovatebot.com/) · [Dependabot](https://docs.github.com/code-security/dependabot)

[Retour à l'index des composants](index.md){ .md-button }
