# CTFd

CTFd est le moteur de scoring, en mode headless derrière le front. Il tourne en 2 à 4 réplicas dans le namespace `ctfd`, avec MariaDB (mariadb-operator), Valkey et Garage.

## Symptômes

- `CtfdDeploymentDown` (critique) : plus aucun pod CTFd disponible ; le front renvoie des erreurs.
- `CtfdMetricsMissing` / `CtfdMetricsStale` : l'exporter de métriques ne répond plus ou ne se rafraîchit plus (le plugin `metrics_exporter`).
- `CtfdIncorrectSubmissionsBurst` : plus de 120 flags incorrects par minute (force brute ou concours très actif).
- `CtfEventPaused` (info) : l'événement est en pause depuis plus d'une heure.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `CtfEventPaused` | info | 60m | L'événement CTF est en pause depuis plus d'une heure |
| `CtfdDeploymentDown` | critical | 3m | CTFd n'a plus aucun pod disponible |
| `CtfdIncorrectSubmissionsBurst` | warning | 5m | Plus de 120 soumissions de flag incorrectes par minute |
| `CtfdMetricsMissing` | warning | 15m | Les métriques CTFd sont absentes |
| `CtfdMetricsStale` | warning | 5m | Métriques CTFd figées depuis plus de 5 minutes |

??? info "Expressions PromQL"

    ```promql
    # CtfEventPaused
    ctfd_event_state{state="paused"} == 1
    # CtfdDeploymentDown
    kube_deployment_status_replicas_available{namespace="ctfd", deployment="ctfd"} == 0
    # CtfdIncorrectSubmissionsBurst
    pad:ctfd_submissions:rate5m{result="incorrect"} * 60 > 120
    # CtfdMetricsMissing
    absent(ctfd_metrics_generated_timestamp_seconds)
    # CtfdMetricsStale
    time() - max(ctfd_metrics_generated_timestamp_seconds) > 300
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl -n ctfd get pods,mariadb,scaledobject
kubectl -n ctfd logs deploy/ctfd --tail=80
kubectl -n ctfd describe pod -l app.kubernetes.io/name=ctfd | sed -n '/Events/,$p'

# Dépendances : base, cache, objets
kubectl -n ctfd get mariadb ctfd-mariadb
kubectl -n storage get pods
```

## Remédiation

1. **Pods en échec au démarrage** : la cause usuelle est MariaDB non prête (`kubectl -n ctfd get mariadb`), un Secret manquant ou erroné (`ctfd-secrets`, voir [Secrets](../SECRETS.md)), ou Garage indisponible (téléversement de fichiers).
2. **Régression après une mise à jour** : revenir en arrière **par un commit** (`git revert`) ; ArgoCD réappliquera l'image précédente.
3. **Base perdue ou corrompue** : [Sauvegarde et restauration](backup-restore.md).
4. **Métriques absentes** : le token `PAD_METRICS_TOKEN` côté scrape ne correspond plus à celui du Secret de CTFd, ou les pods ne répondent pas ; la lecture de `/metrics` exige un `Authorization: Bearer`.
5. **Rafale de soumissions** : identifier le compte dans le portail manager (Modération, filtre par type `incorrect`) et bannir si besoin ; CTFd applique déjà sa limitation de débit (429).
6. **Événement en pause** : voulu pendant une pause d'organisation ; sinon le reprendre depuis le portail manager (Événement) ou `PATCH /api/v1/manager/event` avec `{"paused": false}`.

## Escalade

Si CTFd est indisponible pendant un événement, les soumissions échouent mais ne sont pas perdues côté joueurs : annoncer l'incident, et geler/prolonger l'événement une fois le service rétabli.

Retour à l'[index des runbooks](index.md).
