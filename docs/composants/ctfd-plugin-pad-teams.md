# Plugin CTFd pad_teams

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Remplace les écrans d'équipe natifs par une API compatible SSO : `POST /api/v1/pad/teams`, `/join` et `/leave`. Les mots de passe d'équipe sont protégés contre la force brute **côté CTFd**
(le BFF n'est pas la seule porte d'entrée). Il expose aussi un endpoint interne qui liste les membres d'une équipe, réservé à un jeton de service.

## Où elle tourne et comment elle est déployée

Chargé par CTFd. Variables : `PAD_INTERNAL_TOKEN`, `PAD_TEAM_JOIN_USER_*` (5 échecs / 300 s / verrou 60 s) et `PAD_TEAM_JOIN_TEAM_*` (10 / 900 s / 300 s).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

`apps/ctfd/plugins/pad_teams/__init__.py` ; tests `apps/ctfd/tests/test_pad_teams.py`.

## Interactions avec les autres briques

Utilise le limiteur de [pad_common](ctfd-plugin-pad-common.md) (cache [Valkey](valkey.md)) ; appelé par le [front](frontend.md) ; `GET /api/v1/pad/internal/sources/<kind>/<id>` est réservé à l'authentification interne (Bearer) pour les usages de type [netbird-sync](netbird-sync.md).

## Sécurité

- Message d'erreur volontairement générique à l'adhésion ; verrouillage progressif par utilisateur et par équipe cible, avec `Retry-After`.
- Le capitaine ne peut pas partir tant qu'il y a d'autres membres ; une équipe vide est supprimée.
- L'endpoint interne refuse un token joueur ; membres bannis exclus ; 503 si le jeton n'est pas configuré.

## Supervision

Rafales d'échecs visibles dans les logs d'audit et par `CtfdIncorrectSubmissionsBurst` pour les soumissions : [CTFd](../runbooks/ctfd.md).

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

Uniquement en mode équipes (400 sinon). Un joueur ayant déjà marqué des points ne peut pas quitter son équipe (409).

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
