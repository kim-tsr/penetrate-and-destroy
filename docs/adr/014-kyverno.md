# ADR 14 : Politiques d'admission : Kyverno

**Statut** : acceptée.

## Contexte

Les instances de challenges exécutent du code potentiellement hostile : il faut contraindre ce qui peut tourner sur le cluster.

## Décision

**Kyverno** applique : Pod Security Standards `restricted` en `Enforce` sur `inst-*` et `chall-manager`, vérification des signatures d'images, interdiction du tag `latest`, requests/limits obligatoires, NetworkPolicy par défaut dans les namespaces d'instances.

## Alternatives écartées

- **OPA Gatekeeper** : Rego à apprendre et à maintenir, moins de politiques « mutate/generate ».
- **Pod Security Admission seul** : ne couvre ni signatures, ni labels, ni requests/limits.
- **Aucune politique** : inacceptable pour une plateforme d'exécution de code tiers.

## Conséquences

- Les violations ressortent en alertes `info` ([Kyverno](../runbooks/kyverno.md)) ; les politiques d'admission peuvent bloquer un pod légitime : lire les événements du namespace avant de contourner.
