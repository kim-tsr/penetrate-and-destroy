# MkDocs Material (documentation)

**Couche** : Outillage et CI · **Où** : poste de dev et CI · **Version** : mkdocs 1.6.1, mkdocs-material 9.6.23

## À quoi elle sert ici et pourquoi ce choix

La documentation est du Markdown versionné avec le code et rendue par MkDocs Material (thème sombre/clair, recherche en français, diagrammes Mermaid). La CI la construit en `--strict` : un lien cassé échoue.

## Où elle tourne et comment elle est déployée

`task docs:serve` (aperçu sur http://127.0.0.1:8000 avec rechargement) et `task docs:build` (`mkdocs build --strict`) créent le venv `.venv-docs` et y installent `docs/requirements.txt` s'il est absent ou périmé.

## Version épinglée

`docs/requirements.txt` : `mkdocs==1.6.1`, `mkdocs-material==9.6.23`, `mkdocs-include-markdown-plugin==7.1.8`, `pymdown-extensions==10.21.3`.

## Fichiers de configuration dans le dépôt

`mkdocs.yml` (navigation, thème, extensions), `docs/`, `scripts/Taskfile.docs.yml`, `.github/workflows/docs.yml`.

## Interactions avec les autres briques

Construite par [GitHub Actions](github-actions.md) ; lancée via [Taskfile](taskfile.md) ; `docs/runbooks/` est lié aux alertes de [VictoriaMetrics](victoriametrics.md).

## Sécurité

Aucune valeur réelle dans la documentation : domaine `example.net`, secrets `CHANGEME`, plages privées du contrat ; `check-site-leaks.sh` s'applique aussi aux pages.

## Supervision

Statut du workflow `docs` ; un runbook doit exister pour chaque alerte (vérifié par la CI).

## Opérations courantes

```bash
task docs:serve      # http://127.0.0.1:8000
task docs:build      # mkdocs build --strict, sortie dans site/ (ignoré par Git)
```

## Pièges connus

`site/` et `.venv-docs/` ne sont jamais commités. Un lien vers un fichier hors de `docs/` casse le build strict : citer le chemin en code plutôt qu'en lien.

## Documentation officielle

[squidfunk.github.io/mkdocs-material](https://squidfunk.github.io/mkdocs-material/)

[Retour à l'index des composants](index.md){ .md-button }
