# cert-manager

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `cert-manager`) · **Version** : chart v1.21.2 ; webhook OVH 0.9.18

## À quoi elle sert ici et pourquoi ce choix

Émet et renouvelle les certificats des interfaces internes et des webhooks. Deux émetteurs : `letsencrypt-ovh` (ACME DNS-01 via le webhook OVH, pour les noms publics) et
`pad-internal-ca` (CA interne auto-signée de 10 ans, pour les noms en `*.pad.internal`). Il est aussi nécessaire à Cluster API (injection des `caBundle`).

## Où elle tourne et comment elle est déployée

Installé au bootstrap par Helm puis géré par ArgoCD (`gitops/platform/cert-manager`, sync-wave -7). Un réplica ; CRD conservées (`keep: true`).

## Version épinglée

Charts `cert-manager` v1.21.2 et `cert-manager-webhook-ovh` 0.9.18 dans `gitops/platform/cert-manager/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/cert-manager/values.yaml` (résolveurs récursifs publics pour DNS-01, `enable-certificate-owner-ref`).
- `values-webhook-ovh.yaml` : solver et ClusterIssuer `letsencrypt-ovh`.
- `resources/internal-ca.yaml` : `ClusterIssuer` auto-signé, `Certificate` CA `pad-internal-ca` (ECDSA P-256), émetteur CA.
- `resources/ovh-credentials.example.yaml` (+ générateur ksops) : identifiants OVH.

## Interactions avec les autres briques

Utilise l'API [OVH](tofu-ovh.md) pour la validation DNS-01 ; consommé par les `Ingress` ([Traefik cluster](traefik-cluster.md)) et par [Cluster API](cluster-api.md).

## Sécurité

Identifiants OVH en Secret SOPS à droits limités à la zone DNS ; conteneurs `readOnlyRootFilesystem`, `drop: ALL`, `runAsNonRoot` ; clé de la CA interne en rotation `Always`.

## Supervision

Alertes `CertManagerCertExpiry`, `CertManagerCertNotReady`, `CertExpiry` : [Certificats](../runbooks/certificates.md).

## Opérations courantes

```bash
kubectl get certificates,certificaterequests -A
kubectl describe certificate <nom> -n <namespace>
```

## Pièges connus

- `--dns01-recursive-nameservers-only` impose des résolveurs publics : la sortie vers eux (53) doit être autorisée.
- Supprimer les CRD supprimerait les `Certificate` : c'est pourquoi `keep: true` est positionné.

## Documentation officielle

[cert-manager.io/docs](https://cert-manager.io/docs/)

[Retour à l'index des composants](index.md){ .md-button }
