# Front Next.js

Le front (namespace `frontend`, 2 à 4 réplicas) sert l'espace joueur, le portail manager et le BFF qui appelle CTFd.

## Symptômes

- `FrontendHigh5xxRatio` : plus de 5 % d'erreurs 5xx.
- `FrontendCtfdSlow` : les appels BFF vers CTFd ont un p95 supérieur à 2 s.
- `FrontendMetricsMissing` : les métriques `pad_frontend_*` sont absentes (le scale KEDA devient aveugle).
- Les joueurs sont déconnectés ou voient des erreurs après une rotation de secret.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `FrontendCtfdSlow` | warning | 10m | Les appels du BFF vers CTFd sont lents (p95 > 2 s) |
| `FrontendHigh5xxRatio` | warning | 10m | Plus de 5 % d'erreurs 5xx sur le front |
| `FrontendMetricsMissing` | warning | 15m | Les métriques du front sont absentes |

??? info "Expressions PromQL"

    ```promql
    # FrontendCtfdSlow
    pad:frontend_ctfd_request_duration_seconds:p95_5m > 2
    # FrontendHigh5xxRatio
    pad:frontend_http_5xx_ratio:rate5m > 0.05 and sum(rate(pad_frontend_http_requests_total[5m])) > 0.2
    # FrontendMetricsMissing
    absent(pad_frontend_active_sessions)
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n frontend get pods,scaledobject
kubectl -n frontend logs deploy/frontend --tail=100
curl -s https://ctf.example.net/api/health

# Latence et erreurs côté CTFd
kubectl -n ctfd get pods
kubectl -n ctfd logs deploy/ctfd --tail=50
```

## Remédiation

1. **5xx à cause de CTFd** : voir [CTFd](ctfd.md). Le BFF ne masque pas une panne de CTFd.
2. **401/403 sur `/api/v1/sso/session`** : le secret HMAC `PAD_SSO_SHARED_SECRET` diffère entre le front et CTFd (rotation incomplète). Voir la procédure de [rotation](rotation-secrets.md).
3. **Connexion OIDC en échec** : Authentik est-il joignable ? Voir [Authentik](authentik.md).
4. **Valkey indisponible** : le front retombe sur une mémoire locale (token CTFd par replica) mais perd verrous et partages ; `kubectl -n storage get pods`.
5. **OOM / redémarrages** : [Charges Kubernetes](kubernetes-workloads.md).
6. **Métriques absentes** : l'endpoint `/api/metrics` exige `METRICS_TOKEN` en production ; vérifier que le ServiceMonitor porte le bon token.

## Escalade

Si le front est totalement indisponible, les joueurs n'ont plus d'accès : l'interface d'administration brute de CTFd (`ctfd-admin`, via NetBird staff) permet aux organisateurs de garder la main.

Retour à l'[index des runbooks](index.md).
