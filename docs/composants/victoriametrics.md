# VictoriaMetrics et vmalert

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : v1.154.0 (victoria-metrics et vmalert, digests épinglés)

## À quoi elle sert ici et pourquoi ce choix

VictoriaMetrics stocke les métriques, **scrape lui-même** les exporters des LXC et de l'hôte (vmagent intégré) et reçoit en
`remote_write` celles du cluster ([Alloy](alloy.md)). Il est plus léger que Prometheus pour un seul LXC de 3 Go. **vmalert** évalue
les règles d'alerte (67 alertes) et les envoie à [Alertmanager](alertmanager.md). KEDA interroge aussi VictoriaMetrics pour scaler
CTFd et le front ([KEDA](keda.md)).

## Où elle tourne et comment elle est déployée

Deux conteneurs du Compose de la pile de monitoring (rôle `monitoring-stack`) : `victoriametrics` (8428) et `vmalert` (8880).
Les règles sont copiées depuis `monitoring/rules/` ; elles sont supprimées du LXC si retirées du dépôt.

## Version épinglée

`pad_images.victoriametrics` et `pad_images.vmalert` = v1.154.0 dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`.
Rétention : `monitoring_stack_vm_retention: 30d` dans `infra/ansible/roles/monitoring-stack/defaults/main.yml`.

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/monitoring-stack/` (rôle) et `monitoring/` (contenu versionné).
- `templates/scrape.yml.j2` : jobs `victoriametrics`, `vmalert`, `alertmanager`, `loki`, `tempo`, `grafana`, `node`, `alloy`, `docker`, `pve`, `traefik`, `crowdsec`, `netbird`, `authentik`.
- `monitoring/rules/` : `ctf.yml` (13 alertes), `infra.yml` (22), `monitoring.yml` (7), `platform.yml` (19), `security.yml` (6), `recording.yml` (règles `pad:*`).
- `monitoring/tests/rules/*.test.yml` : tests `promtool test rules`.

## Interactions avec les autres briques

- Scrape : node-exporter, Alloy, Docker, pve-exporter, Traefik, CrowdSec, NetBird, Authentik, OPNsense (voir [exporters](exporters.md)).
- Reçoit le `remote_write` du cluster (Alloy DaemonSet) et les métriques dérivées des traces de [Tempo](tempo.md).
- Alimente [Grafana](grafana.md) et les ScaledObjects de [KEDA](keda.md).
- vmalert notifie [Alertmanager](alertmanager.md).

## Sécurité

- Pas de port exposé hors de la zone : les flux sont ceux de la [matrice](../architecture/flux.md) (push 8428 depuis toutes les zones, scrape depuis MONITORING).
- `no-new-privileges`. Interface accessible en interne seulement (forward-auth Authentik pour `vm.<domaine>`).

## Supervision

Il se supervise lui-même (jobs `victoriametrics` et `vmalert`). Alertes `VmalertRuleErrors`, `VmalertNotifierErrors` :
[Pile de supervision](../runbooks/monitoring-stack.md). Le `Watchdog` prouve que la chaîne vmalert vers Alertmanager vit :
[Watchdog](../runbooks/watchdog.md).

## Opérations courantes

```bash
bash monitoring/scripts/check.sh                  # promtool, amtool, vmalert -dryRun, dashboards
python3 monitoring/scripts/validate.py runbooks   # un runbook par alerte
task ansible:services -- --tags monitoring --limit monitoring
```

## Pièges connus

- Les gauges CTFd et `pad_frontend_active_sessions` sont identiques sur chaque pod : les agréger avec `max()`, jamais `sum()`.
- Le LXC héberge aussi Uptime Kuma : une panne totale du LXC n'est détectée que par un second point de vue (voir [limites](../reference/limites.md)).

## Documentation officielle

[docs.victoriametrics.com](https://docs.victoriametrics.com/)

[Retour à l'index des composants](index.md){ .md-button }
