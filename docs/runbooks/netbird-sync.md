# netbird-sync

Contrôleur Go (namespace `netbird-sync`) qui crée une resource et une policy NetBird pour chaque Service d'instance, au bénéfice du groupe de l'équipe. Sans lui, un joueur ne peut atteindre aucune instance.

## Symptômes

- `NetbirdSyncErrors` : des réconciliations échouent (`netbird_sync_reconcile_errors_total` augmente).
- `NetbirdSyncDeploymentDown` (critique) : plus de pod.
- Un joueur a une instance démarrée mais ne peut pas la joindre en VPN.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `NetbirdSyncDeploymentDown` | critical | 5m | netbird-sync n'a plus aucun pod disponible |
| `NetbirdSyncErrors` | warning | 15m | netbird-sync échoue à réconcilier des instances |

??? info "Expressions PromQL"

    ```promql
    # NetbirdSyncDeploymentDown
    kube_deployment_status_replicas_available{namespace="netbird-sync", deployment="netbird-sync"} == 0
    # NetbirdSyncErrors
    rate(netbird_sync_reconcile_errors_total[10m]) > 0
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n netbird-sync get pods
kubectl -n netbird-sync logs deploy/netbird-sync --tail=100 | jq -r 'select(.level=="ERROR" or .level=="WARN") | "\(.time) \(.msg) \(.err // "")"'

# Services d'instance suivis, et finalizer
kubectl get svc -A --field-selector spec.type=LoadBalancer -o json \
  | jq -r '.items[] | select(.metadata.namespace|startswith("inst-")) | "\(.metadata.namespace)/\(.metadata.name) \(.status.loadBalancer.ingress[0].ip // "pas d IP") \(.metadata.finalizers)"'
```

## Remédiation

1. **401/403 de l'API NetBird** : le jeton (PAT de l'utilisateur de service `netbird-sync`) est expiré ou révoqué. Le recréer dans le dashboard NetBird, le placer dans le secret SOPS de `gitops/apps/netbird-sync` (`NETBIRD_API_TOKEN`), commiter. Voir [Actions manuelles](../operations/actions-post-deploiement.md).
2. **`namespace ... sans label pad.io/team`** : l'instance a été créée hors du scénario standard. Le namespace doit porter `pad.io/team` (et `pad.io/challenge`).
3. **NetBird injoignable** : le LXC `netbird` ou l'`edge` est en cause ; vérifier `https://vpn.example.net`.
4. **Joueur sans accès malgré une policy** : vérifier qu'il est bien dans le groupe `ctf-team-<id>` (provisionné par le flux d'onboarding NetBird), puis que les règles OPNsense autorisent le routing peer vers l'IP d'instance (action manuelle).
5. **Service bloqué en `Terminating`** : le finalizer `pad.io/netbird-sync` attend le nettoyage NetBird. Corriger l'erreur d'API ; en dernier recours, supprimer la policy et la resource à la main dans NetBird, puis `kubectl patch svc -n inst-<id> <nom> --type=merge -p '{"metadata":{"finalizers":null}}'`.

## Escalade

Une réconciliation complète a lieu toutes les 10 minutes : après correction du jeton, les instances en retard se rattrapent seules.

Retour à l'[index des runbooks](index.md).
