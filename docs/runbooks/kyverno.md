# Kyverno

Kyverno applique les politiques d'admission : PSS `restricted` sur `inst-*` et `chall-manager` (Enforce), images d'instance du registre interne par empreinte (Enforce), signature des images (Audit ou Enforce selon `pad-image-policy`), pas de tag `latest`, requests/limits obligatoires, NetworkPolicy par défaut, et génération d'une `ResourceQuota` et d'un `LimitRange` par namespace `inst-*`.

## Symptômes

- `KyvernoPolicyViolations` (info) : des ressources violent une politique (label `policy_name`, namespace).
- `KyvernoMetricsMissing` (info) : les métriques ne sont plus exposées.
- Un pod est refusé à la création avec un message `admission webhook ... denied`.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `KyvernoMetricsMissing` | info | 30m | Les métriques Kyverno sont absentes |
| `KyvernoPolicyViolations` | info | immédiat | Violations Kyverno de la politique &lt;policy_name&gt; |

??? info "Expressions PromQL"

    ```promql
    # KyvernoMetricsMissing
    absent(kyverno_policy_results_total)
    # KyvernoPolicyViolations
    sum by (policy_name, resource_namespace) (increase(kyverno_policy_results_total{rule_result="fail"}[15m])) > 0
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl get clusterpolicy
kubectl get policyreport,clusterpolicyreport -A | head -20
kubectl -n kyverno get pods
kubectl -n kyverno logs deploy/kyverno-admission-controller --tail=50

# Détail d'une violation
kubectl get policyreport -A -o json \
  | jq -r '.items[].results[]? | select(.result=="fail") | "\(.policy) \(.message)"' | sort | uniq -c | head
```

## Remédiation

1. **Image d'un challenge refusée par `restricted`** : l'image doit tourner en utilisateur non-root, sans élévation de privilèges, avec `capabilities: drop ALL`. Corriger le `Dockerfile` du challenge, pas la politique.
2. **Violations en Audit** (`verify-images-audit`) : normal tant que la clé publique cosign n'est pas renseignée. Le passage en `enforce` se fait par le ConfigMap `pad-image-policy` (clé `mode`), pas en éditant les politiques : voir [Images signées](../operations/images-signees.md).
3. **Webhook indisponible** : `verify-images` (Enforce) est en `failurePolicy: Fail` sur `inst-*`, `ctfd`, `frontend` et `netbird-sync`, comme `restrict-instance-images` et `pss-restricted` : un Kyverno down y bloque la création de pods. Relancer `kyverno-admission-controller`. En urgence, repasser `mode: audit` dans `pad-image-policy` (la politique Fail ne s'applique plus ; le webhook reste enregistré).
4. **Pod d'instance refusé pour son image** (`restrict-instance-images`) : l'image doit être sous `registry.pad.internal/ctf/` et épinglée par `@sha256`. Corriger le `challenge.yml`, pas la politique.
5. **Quota ou LimitRange manquant dans un `inst-*`** : générés par `instance-guardrails` à la création du namespace. `kubectl -n inst-<id> get resourcequota,limitrange` ; si absents, vérifier le background controller (`kubectl -n kyverno logs deploy/kyverno-background-controller`).
6. **Métriques absentes** : vérifier le ServiceMonitor du namespace `kyverno`.

## Escalade

Ne jamais désactiver `pss-restricted` pour « faire passer » un challenge : c'est la barrière d'isolement des instances.

Retour à l'[index des runbooks](index.md).
