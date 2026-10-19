# Kyverno

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `kyverno`, pool platform) · **Version** : chart 3.9.1

## À quoi elle sert ici et pourquoi ce choix

Garde-fou d'admission : impose les règles de la plateforme **sans dépendre de la discipline** des auteurs de manifestes. Kyverno applique PSS « restricted » aux pods,
exige des `requests/limits`, refuse le tag `latest`, et, pour chaque namespace d'instance `inst-*`, **génère** le `default-deny`, une `ResourceQuota` et un `LimitRange`,
**impose** des images du registre interne épinglées par empreinte, et vérifie les signatures cosign (mode `audit` par défaut, `enforce` sur décision de l'opérateur).
Décision : [ADR 14](../adr/014-kyverno.md).

## Où elle tourne et comment elle est déployée

Deux Applications ArgoCD : `kyverno` (chart, sync-wave -6) et `kyverno-policies` (politiques, vague -4). Contrôleur d'admission en 2 réplicas (un par worker, anti-affinité préférée, PodDisruptionBudget `minAvailable: 1`), contrôleurs background et reports en 1 réplica, sur le pool platform. Deux et non trois réplicas : sur 2 workers un 3e ne tolère pas plus de pannes de nœud et coûte 160 Mi de requests ; à relever si le pool platform grandit.

## Version épinglée

Chart `kyverno` 3.9.1 dans `gitops/platform/kyverno/application.yaml`.

## Fichiers de configuration dans le dépôt

`gitops/platform/kyverno/policies/` :

| Politique | Mode | Effet |
|---|---|---|
| `pss-restricted.yaml` | Enforce | PSS « restricted » sur les pods |
| `require-requests-limits.yaml` | Enforce | `requests` et `limits` obligatoires |
| `disallow-latest-tag.yaml` | Enforce | pas de tag `latest` |
| `add-default-networkpolicy.yaml` | génération | `default-deny` (entrée et sortie, **sans** autorisation DNS) dans chaque `inst-*` |
| `instance-guardrails.yaml` | génération | `ResourceQuota` et `LimitRange` `pad-instance` dans chaque `inst-*` ; `CiliumNetworkPolicy` DNS limitée à `cluster.local` si le namespace porte `pad.io/dns=cluster-local` (opt-in) |
| `pdb-unhealthy-eviction.yaml` | mutation | tout `PodDisruptionBudget` (y compris ceux des charts) reçoit `unhealthyPodEvictionPolicy: AlwaysAllow` : un pod en échec n'empêche plus le drain d'un nœud |
| `restrict-instance-images.yaml` | **toujours Enforce** | pods `inst-*` : image sous `registry.pad.internal/ctf/` et épinglée par `@sha256:` |
| `verify-images.yaml` (`verify-images` et `verify-images-audit`) | selon `pad-image-policy` | signatures cosign, `inst-*` (clé publique) et `ctfd`, `frontend`, `netbird-sync` (keyless) |

Plus `image-policy-configmap.yaml` (ConfigMap `kyverno/pad-image-policy` : `mode` et clé publique `cosign.pub`) et `rbac-background-controller.yaml` (droits de génération :
`networkpolicies`, `ciliumnetworkpolicies`, `resourcequotas`, `limitranges`).

Quota par instance (2 x les plafonds du contrat `instances.limits_max`) : 2 pods, 2 CPU de requests (4 de limits), 2 Gi de mémoire, 2 Gi de disque éphémère, 2 Services dont 1 `LoadBalancer`,
aucun `NodePort` ni PVC. `LimitRange` par conteneur : défauts 500m / 256Mi / 256Mi de disque éphémère, plafonds 2 CPU / 1Gi / 1Gi.

## Interactions avec les autres briques

Intercepte les créations de pods de toutes les applications, y compris les pods d'instance créés par le [scénario](chall-manager-scenario.md) ; vérifie les images signées par la [CI](github-actions.md) ([cosign et Trivy](cosign-trivy.md)).

## Sécurité

- **Mode de vérification des signatures** : `mode` du ConfigMap `pad-image-policy` (`audit` par défaut, `enforce`), à tenir identique à `instances.image_verification` du contrat. En `audit`, `verify-images-audit`
  (`failurePolicy: Ignore`) rapporte sans bloquer ; en `enforce`, `verify-images` (`failurePolicy: Fail`) refuse les images non signées. Tant que `cosign.pub` vaut `CHANGEME`, la règle du registre interne reste en audit
  même en `enforce`. Procédure : [Images signées](../operations/images-signees.md).
- **Disponibilité** : en `enforce`, un Kyverno indisponible bloque la création de pods dans `inst-*`, `ctfd`, `frontend` et `netbird-sync` (le webhook est limité à ces namespaces ; `kube-system` et `kyverno` ne sont jamais concernés).
- **Images d'instance** : `restrict-instance-images` ne dépend ni du mode ni de la clé, c'est la dernière barrière si le schéma `challenge.yml` et le scénario sont contournés.
- Les namespaces d'instance sont créés par le [scénario](chall-manager-scenario.md) ; les ressources générées sont synchronisées (`synchronize: true`) : une modification à la main est écrasée.

## Supervision

Alertes `KyvernoPolicyViolations`, `KyvernoMetricsMissing` : [Kyverno](../runbooks/kyverno.md) ; ServiceMonitors sur l'admission et le background controller.

## Opérations courantes

```bash
kubectl get clusterpolicies
kubectl get policyreports -A
kubectl describe clusterpolicy pss-restricted
kubectl -n inst-<id> get resourcequota,limitrange,networkpolicy,ciliumnetworkpolicy
kubectl -n kyverno get cm pad-image-policy -o jsonpath='{.data.mode}'
```

## Pièges connus

- Le background controller a besoin de droits RBAC supplémentaires pour générer NetworkPolicy, CiliumNetworkPolicy, ResourceQuota et LimitRange (`rbac-background-controller.yaml`).
- Une instance qui plafonne (`Forbidden: exceeded quota`) ou qui est évincée pour disque éphémère n'est pas une panne : relire les `limits_*` du `challenge.yml` (plafonds du contrat).
- Un pod sans `requests/limits` ou en `:latest` est refusé : c'est voulu, corriger le manifeste.

## Documentation officielle

[kyverno.io/docs](https://kyverno.io/docs/)

[Retour à l'index des composants](index.md){ .md-button }
