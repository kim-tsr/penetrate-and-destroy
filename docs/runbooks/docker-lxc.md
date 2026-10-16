# Docker dans un LXC

Les services d'infrastructure (edge, NetBird, Warpgate, Authentik, monitoring) tournent en Docker Compose dans des LXC non privilégiés. Les métriques de `dockerd` sont exposées sur le port 9323.

## Symptômes

- `DockerDaemonDown` (critique) : le job `docker` ne répond plus sur un LXC (label `host`).
- `DockerHealthchecksFailing` : des healthchecks de conteneurs échouent.
- Les conteneurs d'un LXC sont arrêtés ou ne redémarrent pas.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `DockerDaemonDown` | critical | 5m | dockerd injoignable sur &lt;host&gt; |
| `DockerHealthchecksFailing` | warning | 10m | Healthchecks Docker en échec sur &lt;host&gt; |

??? info "Expressions PromQL"

    ```promql
    # DockerDaemonDown
    up{job="docker"} == 0
    # DockerHealthchecksFailing
    rate(engine_daemon_health_checks_failed_total[10m]) > 0
    ```

## Diagnostic

```bash
# Depuis l'hôte Proxmox : état du LXC et fonctionnalités nécessaires
pct status <vmid>
pct config <vmid> | grep -E "features|unprivileged"     # attendu : nesting=1 (et keyctl=1)

# Dans le LXC
systemctl status docker
journalctl -u docker --since "1 hour ago" | tail -40
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
docker compose --project-directory /opt/pad/<service> ps
df -h / ; free -h
```

## Remédiation

1. `systemctl restart docker` puis `docker compose --project-directory /opt/pad/<service> up -d`.
2. Démon qui ne démarre plus avec une erreur de cgroup, de stockage ou de `keyctl` : vérifier les `features` du LXC (`nesting=1`) ; elles sont posées par la stack `20-services-lxc`. Un `tofu apply` les rétablit.
3. Disque plein : [Disque saturé](host-disk.md).
4. Healthcheck en échec sur un conteneur précis : lire ses journaux (`docker logs <nom>`) ; voir le runbook du service (par exemple [Authentik](authentik.md)).
5. Si le LXC est irrécupérable : le recréer par tofu (`tofu apply -replace`), puis `task ansible:services`. Les données de service (volumes dans `/opt/pad/<service>`) sont perdues sauf sauvegarde.

## Escalade

Le LXC `monitoring` portant Alertmanager, sa panne coupe aussi la notification : voir [Watchdog](watchdog.md).

Retour à l'[index des runbooks](index.md).
