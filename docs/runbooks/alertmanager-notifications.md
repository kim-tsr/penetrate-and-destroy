# Alertmanager n'arrive pas à notifier

Alertmanager reçoit les alertes de vmalert mais échoue à les envoyer (Discord, e-mail ou webhook Uptime Kuma). Tant que ce n'est pas réglé, vous êtes **aveugle** : les alertes existent mais personne ne les voit.

## Symptômes

- Plus aucun message Discord ni e-mail alors que des incidents sont visibles dans Grafana.
- L'alerte `AlertmanagerNotificationsFailing` porte le label `integration` (`discord`, `email`, `webhook`) du canal en échec.
- Dans l'interface Alertmanager, des alertes sont `active` mais jamais `notified`.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `AlertmanagerNotificationsFailing` | warning | 10m | Alertmanager n'arrive pas à notifier via &lt;integration&gt; |

??? info "Expressions PromQL"

    ```promql
    # AlertmanagerNotificationsFailing
    sum by (integration) (rate(alertmanager_notifications_failed_total[10m])) > 0
    ```

## Diagnostic

```bash
# Sur le LXC monitoring (vmid 250, voir la convention d'accès dans l'index des runbooks)
docker compose --project-directory /opt/pad/monitoring logs --since 30m alertmanager | grep -iE "notify|error|failed"

# Compteurs d'échecs par canal
curl -s -G http://10.20.50.10:8428/api/v1/query \
  --data-urlencode 'query=sum by (integration) (rate(alertmanager_notifications_failed_total[10m]))'

# Statut et configuration chargée
curl -s http://10.20.50.10:9093/api/v2/status | head -c 600
```

## Remédiation

1. **Discord** : l'erreur contient en général `404` ou `401`. Le webhook a été supprimé ou régénéré. Créer un nouveau webhook, puis `sops secrets/monitoring.sops.yaml` (clé `discord_webhook_url`).
2. **E-mail** : erreur d'authentification SMTP ou `connection refused`. Vérifier `smtp_smarthost`, `smtp_username`, `smtp_password` dans le même fichier et que l'hôte SMTP est joignable depuis la zone MONITORING (règle d'egress Internet de la zone, voir la [matrice de flux](../architecture/flux.md)).
3. **Webhook Uptime Kuma** : le jeton `uptime_kuma_watchdog_token` ne correspond plus au moniteur push. Voir [Watchdog](watchdog.md).
4. Redéployer la configuration : `task ansible:services` (le rôle `monitoring-stack` rend `alertmanager.yml` et recharge Alertmanager).
5. Tester : `amtool --alertmanager.url=http://10.20.50.10:9093 alert add TestNotif severity=warning --annotation=summary=test`, attendre le message, puis laisser l'alerte expirer.

## Escalade

Si aucun canal ne fonctionne, surveiller Grafana et la page de statut Uptime Kuma à la main pendant la correction. Un échec simultané des trois canaux pointe plutôt vers le réseau du LXC monitoring (voir [OPNsense indisponible](opnsense-down.md)) que vers les secrets.

Retour à l'[index des runbooks](index.md).
