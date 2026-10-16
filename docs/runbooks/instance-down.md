# Cible de supervision injoignable

`InstanceDown` signifie que VictoriaMetrics n'arrive plus à *scraper* une cible depuis 5 minutes. La cible peut être arrêtée, ou seulement injoignable (pare-feu, exporter planté). Le label `job` indique de quoi il s'agit.

## Symptômes

- `InstanceDown` (critique) avec `job` et `instance`.
- Si `OpnsenseDown` est aussi active, les `InstanceDown` en cascade sont inhibées : traiter le routeur d'abord.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `InstanceDown` | critical | 5m | Cible &lt;instance&gt; injoignable |

??? info "Expressions PromQL"

    ```promql
    # InstanceDown
    up{job!~"kubelet|cadvisor"} == 0
    ```

## Diagnostic

```bash
# Quelles cibles sont down ?
curl -s -G http://10.20.50.10:8428/api/v1/query --data-urlencode 'query=up == 0' | jq -r '.data.result[].metric | "\(.job) \(.instance)"'

# Depuis le LXC monitoring : la cible répond-elle ?
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://<instance>/metrics
nc -zv -w3 <ip> <port>
```

| `job` | Source | Port | Où regarder |
|---|---|---|---|
| `node` | node-exporter de l'hôte, d'un LXC ou d'OPNsense | 9100 | `systemctl status prometheus-node-exporter` ; OPNsense : [OPNsense indisponible](opnsense-down.md) |
| `alloy` | Alloy | 12345 | [Télémétrie Alloy](alloy-telemetry.md) |
| `docker` | dockerd d'un LXC | 9323 | [Docker dans un LXC](docker-lxc.md) |
| `pve` | pve-exporter de l'hôte | 9221 | [Hôte Proxmox](proxmox-host.md) |
| autres | exporters applicatifs (Traefik, CrowdSec, NetBird, Authentik...) | voir le contrat | le runbook du service |

## Remédiation

1. Machine éteinte : [Invité Proxmox arrêté](proxmox-guest-down.md).
2. Machine allumée mais cible muette : redémarrer le service concerné (exporter, Docker).
3. Cible joignable en local mais pas depuis monitoring : règle M8 (scrape) manquante, ou zone coupée. Réappliquer `task tofu:apply-stack STACK=60-opnsense-rules`.
4. Cible retirée volontairement (LXC supprimé, nœud scalé à la baisse) : retirer la cible de la configuration de scrape (rôle `monitoring-stack`).

## Escalade

Plusieurs cibles de zones différentes qui tombent en même temps : suspecter OPNsense ou le LXC monitoring lui-même plutôt que chaque service.

Retour à l'[index des runbooks](index.md).
