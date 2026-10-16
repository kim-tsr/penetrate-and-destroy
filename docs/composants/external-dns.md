# external-dns

**Couche** : Plateforme GitOps · **Où** : pod du cluster (0 réplica tant que non activé) · **Version** : chart 1.23.0

## À quoi elle sert ici et pourquoi ce choix

Prévu pour publier automatiquement des enregistrements OVH depuis les Services et Ingress. Aujourd'hui, les enregistrements publics sont gérés par OpenTofu
([provider OVH](tofu-ovh.md)) : le composant est donc **déployé à 0 réplica** (aucune RAM, aucun appel à l'API OVH) et prêt à être activé.

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/external-dns` (sync-wave -3), `replicaCount: 0`, politique `upsert-only` (ne supprime jamais), registre TXT `pad-prod`.

## Version épinglée

Chart `external-dns` 1.23.0 dans `gitops/platform/external-dns/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/external-dns/values.yaml`, `README.md` (procédure d'activation), `secret.example.yaml` et `secret-generator.yaml`.

## Interactions avec les autres briques

Appelle l'API OVH ; sources `service` et `ingress` ; complémentaire de [cert-manager](cert-manager.md).

## Sécurité

Identifiants OVH en Secret SOPS ; `upsert-only` empêche toute suppression accidentelle d'enregistrement.

## Supervision

Aucune tant qu'il est désactivé ; une fois actif, journaux JSON via [Alloy](alloy.md).

## Opérations courantes

Activation (voir `gitops/platform/external-dns/README.md`) : renseigner le Secret chiffré, passer `replicaCount: 1`, fixer `domainFilters`, puis autoriser l'egress
vers l'API OVH dans la NetworkPolicy.

## Pièges connus

Le `domainFilters` du dépôt est un domaine d'exemple (`CHANGEME.example.net`) : le renseigner avec le domaine réel de l'opérateur avant activation.

## Documentation officielle

[kubernetes-sigs.github.io/external-dns](https://kubernetes-sigs.github.io/external-dns/)

[Retour à l'index des composants](index.md){ .md-button }
