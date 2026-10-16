# Watchdog (dead-man's switch)

`Watchdog` est une alerte **toujours active** (`vector(1)`), de sévérité `none` : elle ne notifie personne. Alertmanager la transmet toutes les 5 minutes à un moniteur « push » d'Uptime Kuma. C'est l'*absence* de ce signal qui alerte : elle prouve que la chaîne vmalert, Alertmanager, réseau, Uptime Kuma fonctionne.

## Symptômes

- Uptime Kuma signale le moniteur « Watchdog Alertmanager » en panne (message Discord de sa propre notification).
- Dans l'interface Alertmanager, l'alerte `Watchdog` est absente (vmalert ou Alertmanager arrêté).
- Aucun symptôme si tout va bien : voir `Watchdog` active dans Alertmanager est **normal**.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `Watchdog` | none | immédiat | Watchdog : la chaîne d'alerte fonctionne |

??? info "Expressions PromQL"

    ```promql
    # Watchdog
    vector(1)
    ```

## Diagnostic

```bash
cd /opt/pad/monitoring
docker compose ps
curl -s http://10.20.50.10:9093/api/v2/alerts | jq -r '.[] | select(.labels.alertname=="Watchdog") | .status.state'
docker compose logs --since 30m alertmanager | grep -i watchdog
docker compose logs --since 30m vmalert | tail -20
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://10.20.50.10:3001/
```

## Remédiation

1. **vmalert arrêté** : `docker compose up -d vmalert` ; voir [Pile de supervision](monitoring-stack.md).
2. **Alertmanager arrêté** : idem pour `alertmanager`.
3. **Chaîne vivante mais Uptime Kuma ne reçoit rien** : le récepteur `watchdog` n'a pas de jeton (`uptime_kuma_watchdog_token` absent de `secrets/monitoring.sops.yaml`) ou le moniteur push a été recréé avec un autre jeton. Aligner les deux, puis `task ansible:services`.
4. **LXC monitoring tombé** : Uptime Kuma l'est aussi (même LXC). C'est le cas où le Watchdog ne peut pas vous prévenir ; un second point de vue externe est une amélioration prévue (voir [limites connues](../reference/limites.md)).
5. **Test volontaire** : arrêter `alertmanager` quelques minutes confirme que l'alerte d'absence arrive.

## Escalade

Sans jeton Watchdog configuré, la détection de panne totale de la chaîne n'existe pas : le renseigner fait partie des [actions post-déploiement](../operations/actions-post-deploiement.md).

Retour à l'[index des runbooks](index.md).
