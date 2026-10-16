# ArgoCD

ArgoCD réconcilie le cluster avec le dépôt. Une Application désynchronisée ou dégradée signifie que le cluster ne correspond plus à ce qui est commité, ou que le commité ne s'applique pas.

## Symptômes

- `ArgoCDOutOfSync` : une Application diffère du dépôt (dérive manuelle, ou changement non encore appliqué).
- `ArgoCDAppUnhealthy` (critique) : `Degraded` ou `Missing` : des ressources ne démarrent pas ou n'existent pas.
- `ArgoCDSyncFailed` : la dernière synchronisation a échoué (erreur de manifeste, de ksops, de webhook d'admission).

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `ArgoCDAppUnhealthy` | critical | 15m | Application ArgoCD &lt;name&gt; en état &lt;health_status&gt; |
| `ArgoCDOutOfSync` | warning | 30m | Application ArgoCD &lt;name&gt; désynchronisée |
| `ArgoCDSyncFailed` | warning | immédiat | Synchronisation ArgoCD en échec pour &lt;name&gt; |

??? info "Expressions PromQL"

    ```promql
    # ArgoCDAppUnhealthy
    argocd_app_info{health_status=~"Degraded|Missing"} == 1
    # ArgoCDOutOfSync
    argocd_app_info{sync_status="OutOfSync"} == 1
    # ArgoCDSyncFailed
    increase(argocd_app_sync_total{phase=~"Error|Failed"}[30m]) > 0
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n argocd get applications

# Détail d'une Application : conditions et dernière opération
APP=ctfd
kubectl -n argocd get application "$APP" -o jsonpath='{range .status.conditions[*]}{.type}: {.message}{"\n"}{end}'
kubectl -n argocd get application "$APP" -o jsonpath='{.status.operationState.message}{"\n"}'

# Ressources non saines
kubectl -n argocd get application "$APP" -o json \
  | jq -r '.status.resources[] | select(.health.status != "Healthy" and .health.status != null) | "\(.kind)/\(.name): \(.health.status) \(.health.message // "")"'

kubectl -n argocd logs deploy/argocd-repo-server --tail=50
kubectl -n argocd logs statefulset/argocd-application-controller --tail=50
```

## Remédiation

1. **Erreur `ksops` / `no identity matched`** : le Secret `sops-age` est absent, ou la clé du cluster n'est pas recipient du fichier. Voir [Secrets](../SECRETS.md), section Dépannage : `task secrets:update-keys`, commiter, puis `task bootstrap:gitops` pour recréer `sops-age`.
2. **Erreur de rendu (kustomize, Helm)** : corriger le manifeste dans le dépôt, vérifier avec `bash scripts/validate-gitops.sh`, commiter et pousser. ArgoCD resynchronise seul.
3. **Webhook d'admission refusé** (Kyverno) : lire le message de l'opération, voir [Kyverno](kyverno.md).
4. **Dérive manuelle** : laisser `selfHeal` corriger, ou forcer un rafraîchissement : `kubectl -n argocd annotate application "$APP" argocd.argoproj.io/refresh=hard --overwrite`.
5. **Ressource bloquée à la suppression** (finalizer) : identifier la ressource dans `.status.resources`, comprendre pourquoi son contrôleur ne la nettoie pas avant d'ôter le finalizer.
6. Ne jamais corriger par `kubectl apply` : la correction doit passer par un commit, sinon elle sera écrasée.

## Escalade

Si l'Application `root` elle-même est en cause, ou si ArgoCD est indisponible, le cluster continue de fonctionner mais ne se met plus à jour. En dernier recours, rejouer `task bootstrap:gitops` (idempotent).

Retour à l'[index des runbooks](index.md).
