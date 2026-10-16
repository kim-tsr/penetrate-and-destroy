# Plugin CTFd pad_common

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Évite de dupliquer la logique transverse : authentification des endpoints `pad_*` (token API et HMAC du BFF), rôles applicatifs (`manager`, `admin`), limiteur d'échecs à verrouillage
progressif, journal d'audit JSON, état de l'événement, requêtes de score (first blood) et client de l'API REST de chall-manager. Il n'enregistre aucune route.

## Où elle tourne et comment elle est déployée

Copié dans l'image `pad-ctfd` avec les autres plugins (`apps/ctfd/Dockerfile`). Importé par les autres plugins (`CTFd.plugins.pad_common.*`).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

`apps/ctfd/plugins/pad_common/` : `auth.py`, `roles.py`, `ratelimit.py`, `audit.py`, `event.py`, `scores.py`, `settings.py`, `chall_manager.py`.

## Interactions avec les autres briques

Utilisé par [sso_bridge](ctfd-plugin-sso-bridge.md), [chall_manager_bridge](ctfd-plugin-chall-manager-bridge.md), [pad_teams](ctfd-plugin-pad-teams.md), [pad_public](ctfd-plugin-pad-public.md), [manager_api](ctfd-plugin-manager-api.md), [metrics_exporter](ctfd-plugin-metrics-exporter.md).

## Sécurité

- Le rôle `manager` est un champ utilisateur caché (`pad_roles`), non éditable par l'utilisateur ; le sub OIDC est dans une table dédiée indexée.
- Limiteur d'échecs : verrous à TTL dans le cache (Valkey en production), durée doublée à chaque récidive, plafonnée.
- Journal d'audit sans e-mail, mot de passe, token ni flag soumis.
- Configuration lue à chaque appel (env puis défaut) : un Secret modifié est pris en compte au redémarrage du pod.

## Supervision

Journal d'audit `pad.audit` (une ligne JSON sur stderr, collectée par [Alloy](alloy.md) vers Loki).

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

Le client chall-manager cible l'API REST (grpc-gateway) de la lignée v0.6.x : une montée de version de chall-manager impose de revérifier `chall_manager.py`.

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
