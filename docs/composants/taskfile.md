# Taskfile (go-task)

**Couche** : Outillage et CI · **Où** : poste opérateur, CI · **Version** : go-task du devshell

## À quoi elle sert ici et pourquoi ce choix

Toutes les opérations passent par `task` : `task up` reconstruit tout, `task destroy` efface tout (avec confirmation), `task lint` rejoue les vérifications de la CI. Le Taskfile racine inclut
les Taskfiles de `infra/tofu`, `infra/ansible`, `bootstrap`, `apps`, `scripts/Taskfile.secrets.yml` et `scripts/Taskfile.docs.yml`.

## Où elle tourne et comment elle est déployée

Binaire `task` du devshell ([Nix](nix.md)). Aucune installation côté serveur.

## Version épinglée

go-task : version de nixpkgs figée par `flake.lock` (`version: "3"` du format de Taskfile).

## Fichiers de configuration dans le dépôt

- `Taskfile.yml` (racine : `up`, `destroy`, `rebuild`, `verify`, `backup`, `restore`, `e2e`, `load`, `lint`, `site:node`).
- `infra/tofu/Taskfile.yml`, `infra/ansible/Taskfile.yml`, `bootstrap/Taskfile.yml`, `apps/Taskfile.yml`, `scripts/Taskfile.secrets.yml`, `scripts/Taskfile.docs.yml`.
- Référence des tâches : [Tâches](../reference/taches.md).

## Interactions avec les autres briques

Enchaîne [OpenTofu](opentofu.md), [Ansible](ansible.md), le bootstrap ([kind](kind.md)), les builds d'images et les validations.

## Sécurité

`task destroy` exige une confirmation explicite (`scripts/confirm-destroy.sh`, taper `destroy`, ou `PAD_CONFIRM_DESTROY=destroy`).

## Supervision

Aucune. La CI vérifie que `task --list-all` fonctionne (job `taskfile`).

## Opérations courantes

```bash
task --list
task up
task docs:serve
```

## Pièges connus

`task up` enchaîne les stacks dans un ordre précis : ne pas appliquer une stack isolée sans comprendre ses dépendances (voir [Up](../runbooks/up.md)).

## Documentation officielle

[taskfile.dev](https://taskfile.dev/)

[Retour à l'index des composants](index.md){ .md-button }
