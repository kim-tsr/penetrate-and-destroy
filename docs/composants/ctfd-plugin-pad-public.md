# Plugin CTFd pad_public

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Deux lectures dont le front a besoin et que CTFd n'expose pas : `GET /api/v1/pad/event` (début, fin, gel, pause et état calculé) et `GET /api/v1/pad/first-bloods` (premier solve de
chaque challenge, limité aux comptes visibles et aux solves antérieurs au gel pour un joueur).

## Où elle tourne et comment elle est déployée

Chargé par CTFd, sans variable propre ; l'état de l'événement vient de la configuration CTFd (`start`, `end`, `freeze`, `paused`).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

`apps/ctfd/plugins/pad_public/__init__.py` ; utilise `pad_common/event.py` et `scores.py` ; tests `apps/ctfd/tests/test_pad_public.py`.

## Interactions avec les autres briques

Lu par le [front](frontend.md) (qui en garde une copie dans [Valkey](valkey.md)) ; l'état est modifiable par le portail manager via [manager_api](ctfd-plugin-manager-api.md).

## Sécurité

Lecture réservée à un joueur authentifié ; comptes bannis ou cachés exclus ; aucun flag ni donnée personnelle.

## Supervision

Alerte `CtfEventPaused` (événement en pause) : [CTFd](../runbooks/ctfd.md).

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

L'état est évalué dans l'ordre `not_started`, `ended`, `paused`, `frozen` ; sans copie dans Valkey et si CTFd est indisponible, le front se rabat sur `PAD_EVENT_START` / `PAD_EVENT_END`.

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
