# Kyverno

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `kyverno`, pool platform) · **Version** : chart 3.9.1

## À quoi elle sert ici et pourquoi ce choix

Garde-fou d'admission : impose les règles de la plateforme **sans dépendre de la discipline** des auteurs de manifestes. Kyverno applique PSS « restricted » aux pods,
exige des `requests/limits`, refuse le tag `latest`, génère un `default-deny` dans les namespaces, et vérifie les signatures cosign des images du registry interne
(en mode audit). Décision : [ADR 14](../adr/014-kyverno.md).

## Où elle tourne et comment elle est déployée

Deux Applications ArgoCD : `kyverno` (chart, sync-wave -6) et `kyverno-policies` (politiques, vague -4). Un réplica de chaque contrôleur sur le pool platform.

## Version épinglée

Chart `kyverno` 3.9.1 dans `gitops/platform/kyverno/application.yaml`.

## Fichiers de configuration dans le dépôt

`gitops/platform/kyverno/policies/` :

| Politique | Mode |
|---|---|
| `pss-restricted.yaml` | Enforce |
| `require-requests-limits.yaml` | Enforce |
| `disallow-latest-tag.yaml` | Enforce |
| `add-default-networkpolicy.yaml` (génère `default-deny` et `allow-dns-egress`) | génération |
| `verify-images.yaml` (cosign, `registry.pad.internal/*`) | Audit, `failurePolicy: Ignore` |

Plus `cosign-pubkey-configmap.yaml` et `rbac-background-controller.yaml`.

## Interactions avec les autres briques

Intercepte les créations de pods de toutes les applications, y compris les pods d'instance créés par le [scénario](chall-manager-scenario.md) ; vérifie les images signées par la [CI](github-actions.md) ([cosign et Trivy](cosign-trivy.md)).

## Sécurité

La vérification de signature est en **Audit** et le webhook en `Ignore` pour ne pas bloquer le cluster si Kyverno est indisponible : choix de disponibilité, à durcir une fois les images toutes signées.

## Supervision

Alertes `KyvernoPolicyViolations`, `KyvernoMetricsMissing` : [Kyverno](../runbooks/kyverno.md) ; ServiceMonitors sur l'admission et le background controller.

## Opérations courantes

```bash
kubectl get clusterpolicies
kubectl get policyreports -A
kubectl describe clusterpolicy pss-restricted
```

## Pièges connus

- Le background controller a besoin de droits RBAC supplémentaires pour générer des NetworkPolicy (`rbac-background-controller.yaml`).
- Un pod sans `requests/limits` ou en `:latest` est refusé : c'est voulu, corriger le manifeste.

## Documentation officielle

[kyverno.io/docs](https://kyverno.io/docs/)

[Retour à l'index des composants](index.md){ .md-button }
