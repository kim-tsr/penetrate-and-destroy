# Plugin CTFd chall_manager_bridge

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Ajoute le type de challenge `dynamic_instance` et l'API `/api/v1/instances` (lister, démarrer, prolonger, arrêter). Il fait le lien entre l'identité de l'équipe (`team-<id>` ou `user-<id>`) et
[chall-manager](chall-manager.md), applique **quota, cooldown, renouvellements, pause** et ne renvoie jamais les flags d'instance.

## Où elle tourne et comment elle est déployée

Chargé par CTFd ; table `pad_dynamic_instance_challenge` ajoutée à la base. Variables `PAD_CHALL_MANAGER_URL`, `PAD_GENERIC_SCENARIO`, `PAD_INSTANCES_MAX_PER_SOURCE` (3), `PAD_INSTANCES_COOLDOWN_SECONDS` (30), `PAD_INSTANCES_MAX_TOTAL` (90, limite globale ; contrat `instances.max_total`).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

- `apps/ctfd/plugins/chall_manager_bridge/__init__.py`, `models.py`, `assets/` ; tests `apps/ctfd/tests/test_chall_manager_bridge.py` (avec `fake_cm.py`).

## Interactions avec les autres briques

Appelle [chall-manager](chall-manager.md) (client de [pad_common](ctfd-plugin-pad-common.md)) ; appelé par le [front](frontend.md) ; les instances créées sont synchronisées par [netbird-sync](netbird-sync.md).

## Sécurité

- Managers et admins contournent quota, cooldown, pause et visibilité (utile au test d'instance).
- 403 sans équipe en mode équipes ; 404 si le challenge n'est pas visible ; 502 si chall-manager est injoignable.
- Une NetworkPolicy ne laisse atteindre chall-manager que depuis le namespace CTFd.

## Supervision

Alertes `CtfdInstancesDrift`, `ChallManagerErrorRate` : [Instances de challenges](../runbooks/instances.md) ; gauge `pad_instances_active`.

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

- Le délai de création peut dépasser 300 s dans le pire cas (`PAD_CHALL_MANAGER_TIMEOUT_SECONDS`).
- `DELETE` est idempotent (un 404 de chall-manager est ignoré).

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
