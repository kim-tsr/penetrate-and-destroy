# Plugin CTFd manager_api

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Permet aux **managers** (sans être admins CTFd) d'importer des challenges par ZIP, de consulter des statistiques, de modérer (bannir ou masquer des comptes, invalider soumissions et awards) et de
piloter l'événement (début, fin, gel, pause). Il remplace l'API admin native, qui n'est plus utilisée par le front.

## Où elle tourne et comment elle est déployée

Chargé par CTFd. L'import valide `challenge.yml` avec le schéma `challenges/schema/challenge.schema.json` (copié dans l'image via le contexte de build nommé `schema`).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

- `apps/ctfd/plugins/manager_api/` : `__init__.py`, `archive.py` (lecture sûre du ZIP), `schema.py`.
- `challenges/schema/challenge.schema.json` (source unique du format) ; tests `test_manager_api.py`, `test_manager_moderation.py`.
- Limites : `PAD_IMPORT_MAX_ZIP_BYTES` (50 Mio), `PAD_IMPORT_MAX_ENTRIES` (200), `PAD_IMPORT_MAX_RATIO` (200)...

## Interactions avec les autres briques

Téléverse les fichiers vers [Garage](garage.md) par le fournisseur d'upload de CTFd ; enregistre le scénario dans [chall-manager](chall-manager.md) ; appelé par le [front](frontend.md) ; image du challenge dans [Zot](zot.md).

## Sécurité

- Anti zip-bomb et anti zip-slip : archive lue **en mémoire** (jamais extraite), chemins absolus, `..`, antislash, liens symboliques et entrées chiffrées refusés, tailles mesurées sur les octets réellement décompressés.
- Import idempotent (clé `name`) ; challenges importés **masqués** par défaut ; 502 sans écriture si chall-manager est injoignable.
- Bannir un compte supprime ses tokens ; chaque action de modération est journalisée (audit JSON).

## Supervision

Journal d'audit `pad.audit` ; erreurs d'import dans les logs : [CTFd](../runbooks/ctfd.md). Guide : [Import par ZIP](../manager/import-zip.md).

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

- Changer le type d'un challenge existant renvoie 409 : le supprimer d'abord.
- Un 413 immédiat vient souvent de l'ingress : il doit accepter au moins `PAD_IMPORT_MAX_ZIP_BYTES`.

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
