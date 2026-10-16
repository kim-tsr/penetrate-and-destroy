# Ingress Traefik du cluster

Traefik (namespace `traefik`, IP `10.20.60.200`) reçoit le trafic transmis par `edge` et le route vers le front, CTFd et les services internes.

## Symptômes

- `IngressHigh5xxRatio` : plus de 5 % de 5xx.
- `IngressHighLatency` : p95 supérieur à 2 s.
- Pages lentes ou erreurs 502/503/504 côté joueurs.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `IngressHigh5xxRatio` | warning | 10m | Plus de 5 % d'erreurs 5xx sur l'ingress Traefik |
| `IngressHighLatency` | warning | 10m | Latence p95 de l'ingress supérieure à 2 s |

??? info "Expressions PromQL"

    ```promql
    # IngressHigh5xxRatio
    pad:traefik_5xx_ratio:rate5m > 0.05 and sum(rate(traefik_service_requests_total[5m])) > 0.2
    # IngressHighLatency
    pad:traefik_request_duration_seconds:p95_5m > 2 and sum(rate(traefik_service_requests_total[5m])) > 0.2
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n traefik get pods
kubectl -n traefik logs deploy/traefik --tail=100 | grep -E ' (50[0-9]) '

# Quel service renvoie les 5xx ?
curl -s -G http://10.20.50.10:8428/api/v1/query \
  --data-urlencode 'query=topk(5, sum by (service, code) (rate(traefik_service_requests_total{code=~"5.."}[5m])))'

# Backends
kubectl -n frontend get pods ; kubectl -n ctfd get pods
```

## Remédiation

1. Le 5xx vient presque toujours du **backend**, pas de Traefik : suivre [Front](frontend.md) ou [CTFd](ctfd.md).
2. Backends sains mais lents : ils manquent de réplicas, voir [Autoscaling](autoscaling.md).
3. `413 Request Entity Too Large` sur l'import de challenges : l'ingress doit autoriser un corps au moins égal à `PAD_IMPORT_MAX_ZIP_BYTES` (50 Mio) sur `/api/manage/import`.
4. Pods Traefik en redémarrage : [Charges Kubernetes](kubernetes-workloads.md).
5. Côté public, vérifier aussi le LXC `edge` : `docker compose --project-directory /opt/pad/edge logs traefik`.

## Escalade

Une latence qui monte avec le nombre de joueurs est un signal pour relever les plafonds de réplicas et lancer un test `task load` hors événement.

Retour à l'[index des runbooks](index.md).
