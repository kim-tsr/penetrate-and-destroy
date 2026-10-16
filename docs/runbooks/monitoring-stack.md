# Pile de supervision

Défaillances de la pile elle-même (LXC monitoring, vmid 250) : évaluation des règles par vmalert, envoi vers Alertmanager, serveur Loki.

## Symptômes

- `VmalertRuleErrors` : une règle ne s'évalue plus (label `alertname`).
- `VmalertNotifierErrors` : vmalert n'arrive pas à joindre Alertmanager.
- `LokiServerErrors` : Loki renvoie des 5xx.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `LokiServerErrors` | warning | 10m | Loki renvoie des erreurs 5xx |
| `VmalertNotifierErrors` | warning | 10m | vmalert n'arrive pas à joindre Alertmanager |
| `VmalertRuleErrors` | warning | 10m | Erreurs d'évaluation de règles vmalert (&lt;alertname&gt;) |

??? info "Expressions PromQL"

    ```promql
    # LokiServerErrors
    sum(rate(loki_request_duration_seconds_count{status_code=~"5.."}[5m])) > 0.1
    # VmalertNotifierErrors
    increase(vmalert_alerts_send_errors_total[10m]) > 0
    # VmalertRuleErrors
    increase(vmalert_alerting_rules_errors_total[10m]) > 0
    ```

## Diagnostic

```bash
cd /opt/pad/monitoring
docker compose ps
docker compose logs --since 30m vmalert | tail -30
docker compose logs --since 30m loki | tail -30
docker compose logs --since 30m alertmanager | tail -20

curl -s http://10.20.50.10:8880/api/v1/rules | jq '[.data.groups[].rules[] | select(.lastError != "")] | length'
curl -s http://10.20.50.10:9093/-/ready ; curl -s http://10.20.50.10:3100/ready
df -h /
```

## Remédiation

1. **Erreur de règle** : généralement une métrique renommée ou une syntaxe invalide. Valider avec `bash monitoring/scripts/check.sh`, corriger dans `monitoring/rules/`, redéployer (`task ansible:services`).
2. **Alertmanager injoignable** : `docker compose up -d alertmanager`, vérifier l'espace disque et la configuration rendue (`amtool check-config`).
3. **Loki 5xx** : disque plein (voir [Disque saturé](host-disk.md)), limites d'ingestion dépassées, ou mémoire. Redémarrer `loki` après avoir libéré de l'espace.
4. **Mémoire** : le LXC dispose de 3 Go pour six services ; voir [CPU, mémoire, horloge](host-resources.md).

## Escalade

Une panne complète du LXC monitoring supprime à la fois la mesure et l'alerte : le heartbeat Watchdog est le seul filet ([Watchdog](watchdog.md)).

Retour à l'[index des runbooks](index.md).
