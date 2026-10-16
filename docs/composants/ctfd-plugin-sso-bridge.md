# Plugin CTFd sso_bridge

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Le front authentifie l'utilisateur auprès d'[Authentik](authentik.md), puis échange cette identité contre un **token API CTFd court** via `POST /api/v1/sso/session`, signé en HMAC-SHA256.
CTFd n'a donc plus de formulaire de login ; les rôles viennent des groupes OIDC et sont resynchronisés à chaque appel.

## Où elle tourne et comment elle est déployée

Chargé par CTFd au démarrage. Secrets : `PAD_SSO_SHARED_SECRET` (et `_PREVIOUS` pour la rotation) dans `ctfd-secrets`, valeur identique côté front.

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

- `apps/ctfd/plugins/sso_bridge/__init__.py`, tests `apps/ctfd/tests/test_sso_bridge.py`, `test_auth_contract.py`.
- Variables : `PAD_SSO_MAX_SKEW_SECONDS` (60), `PAD_SSO_TOKEN_TTL_SECONDS`, `PAD_SSO_ALLOWED_CIDRS`, `PAD_GROUP_ADMINS/MANAGERS/PLAYERS`, `PAD_HIDE_MANAGERS`.

## Interactions avec les autres briques

Appelé par le [BFF du front](frontend.md) uniquement ; s'appuie sur [pad_common](ctfd-plugin-pad-common.md) (HMAC, rôles) ; le token est partagé entre replicas via [Valkey](valkey.md).

## Sécurité

- HMAC sur méthode, chemin, horodatage, nonce et hash du corps ; fenêtre ±60 s ; **nonce à usage unique** (anti-rejeu) ; 503 si aucun secret (fail closed).
- Restriction facultative par CIDR de la source directe (`PAD_SSO_ALLOWED_CIDRS`, ici le CIDR des pods) ; la NetworkPolicy du namespace `ctfd` n'autorise en entrée que le front, Traefik et la supervision.
- Aucune liaison de comptes par e-mail (409 si l'e-mail appartient à un compte non lié à ce `sub`) ; un compte banni reçoit 403.
- Managers masqués du scoreboard.

## Supervision

Erreurs 4xx/5xx visibles dans les logs et sur le dashboard du front ; voir [Front](../runbooks/frontend.md) et [CTFd](../runbooks/ctfd.md).

## Opérations courantes

Rotation du secret (sans coupure) : poser `PAD_SSO_SHARED_SECRET_PREVIOUS` = ancienne valeur et `PAD_SSO_SHARED_SECRET` = nouvelle côté CTFd, changer le front, puis retirer `_PREVIOUS`
([Rotation des secrets](../runbooks/rotation-secrets.md)).

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

- Le token vit 900 s alors que la session du navigateur dure 12 h : le front le renouvelle (voir [Front](frontend.md)).
- Un compte déconnecté par erreur : le front déconnecte l'utilisateur sur 400/401/403/409, pas sur une indisponibilité (502).

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
