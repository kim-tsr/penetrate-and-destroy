# CPU, mémoire et horloge

Saturation de ressources d'une machine (hôte, LXC) et désynchronisation d'horloge. Le budget cible est un surcommit CPU de 8 vCPU et environ 26 Go de RAM, ARC ZFS plafonné à 4 Go.

## Symptômes

- `HighMemory` (plus de 90 %), `HighCpu` (plus de 90 % sur 5 minutes), `OomKillDetected` (le noyau a tué un processus), `ClockSkew` (décalage supérieur à 50 ms sans synchronisation).
- Lenteurs, services qui redémarrent, échecs d'authentification (jetons à durée courte, TOTP).

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `ClockSkew` | warning | 10m | Horloge désynchronisée sur &lt;instance&gt; |
| `HighCpu` | warning | 15m | CPU saturé sur &lt;instance&gt; |
| `HighMemory` | warning | 10m | Mémoire presque saturée sur &lt;instance&gt; |
| `OomKillDetected` | warning | immédiat | OOM killer déclenché sur &lt;instance&gt; |

??? info "Expressions PromQL"

    ```promql
    # ClockSkew
    abs(node_timex_offset_seconds) > 0.05 and node_timex_sync_status == 0
    # HighCpu
    instance:node_cpu_used:ratio5m > 0.90
    # HighMemory
    instance:node_memory_used:ratio > 0.90
    # OomKillDetected
    increase(node_vmstat_oom_kill[10m]) > 0
    ```

## Diagnostic

```bash
uptime ; free -h
ps aux --sort=-%mem | head -10
dmesg -T | grep -iE "out of memory|oom-kill" | tail
docker stats --no-stream            # LXC avec Docker

# Horloge
timedatectl
chronyc tracking 2>/dev/null || systemctl status systemd-timesyncd

# Hôte : ARC ZFS
cat /sys/module/zfs/parameters/zfs_arc_max
```

## Remédiation

1. **Processus gourmand** : identifier le conteneur (`docker stats`), puis soit corriger la cause (requête, boucle), soit relever la mémoire du LXC : `pct set <vmid> -memory <Mo>` et aligner `memory_mb` dans le contrat.
2. **Hôte saturé** : réduire le maximum de nœuds `challenges` (voir [Scaling](../architecture/scaling.md)), ou arrêter des instances de challenges ([Instances](instances.md)).
3. **OOM récurrent d'un LXC** : la limite est trop basse pour la charge ; ne pas simplement redémarrer.
4. **Horloge** : un LXC partage l'horloge de l'hôte. Corriger la synchronisation de l'**hôte** (`chronyc makestep`), et vérifier que l'hôte atteint ses serveurs NTP (règle d'egress 123/udp, I5).
5. **Dérive d'horloge d'un nœud Talos** : `talosctl time` ; Talos se synchronise seul, le blocage est presque toujours une règle réseau.

## Escalade

Surveiller `HighMemory` sur l'hôte : un OOM sur l'hôte peut tuer une VM entière. En cas de doute, arrêter des charges non essentielles avant de redémarrer.

Retour à l'[index des runbooks](index.md).
