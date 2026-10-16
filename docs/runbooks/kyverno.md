# Kyverno

Kyverno applique les politiques d'admission : PSS `restricted` sur `inst-*` et `chall-manager` (Enforce), signature des images (Audit), pas de tag `latest`, requests/limits obligatoires, NetworkPolicy par défaut.

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
2. **Violations en Audit** (`verify-images`) : normal tant que la clé publique cosign n'est pas renseignée. Pour passer en `Enforce`, renseigner `pad-image-policy`, vérifier que toutes les images du registry sont signées par la CI, puis changer `validationFailureAction` par commit.
3. **Webhook indisponible** : la politique est en `failurePolicy: Ignore` pour `verify-images`, mais les politiques Enforce peuvent bloquer des créations si Kyverno est down. Relancer `kyverno-admission-controller`.
4. **Métriques absentes** : vérifier le ServiceMonitor du namespace `kyverno`.

## Escalade

Ne jamais désactiver `pss-restricted` pour « faire passer » un challenge : c'est la barrière d'isolement des instances.

Retour à l'[index des runbooks](index.md).
