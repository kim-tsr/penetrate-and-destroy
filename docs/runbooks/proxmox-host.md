# Hôte Proxmox

L'hôte Proxmox porte tout. Sa supervision repose sur `pve-exporter` (port 9221) et `node-exporter` installés par le rôle `host-tuning`.

## Symptômes

- `PveNodeDown` (critique) : le nœud est indisponible (`pve_up == 0`).
- `PveHostMemoryHigh` : mémoire de l'hôte supérieure à 92 %.
- Toute la plateforme est inaccessible (si l'hôte est réellement éteint).

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `PveHostMemoryHigh` | warning | 15m | Mémoire de l'hôte Proxmox &lt;id&gt; à &lt;valeur&gt; |
| `PveNodeDown` | critical | 2m | Le nœud Proxmox &lt;id&gt; est indisponible |

??? info "Expressions PromQL"

    ```promql
    # PveHostMemoryHigh
    pve_memory_usage_bytes{id=~"node/.+"} / pve_memory_size_bytes{id=~"node/.+"} > 0.92
    # PveNodeDown
    pve_up{id=~"node/.+"} == 0
    ```

## Diagnostic

```bash
# Sur l'hôte Proxmox (SSH ou console) :
uptime ; free -h
systemctl status pve-cluster pvedaemon pveproxy
systemctl status prometheus-pve-exporter
pvesh get /cluster/resources --type vm --output-format json | jq -r '.[] | "\(.vmid) \(.name) \(.status) \(.mem)"'
arc_summary 2>/dev/null | head -20 || cat /proc/spl/kstat/zfs/arcstats | grep -E '^size|^c_max'
```

## Remédiation

1. **Faux positif** (exporter arrêté, hôte vivant) : `systemctl restart prometheus-pve-exporter`. `PveNodeDown` est à distinguer d'un simple défaut de scrape (`InstanceDown`, job `pve`).
2. **Hôte réellement arrêté** : redémarrer l'hôte (console ou accès physique). Après le redémarrage, vérifier les invités avec `onboot`.
3. **Mémoire** : (1) ARC ZFS plafonné à 4 Go (`zfs_arc_max_bytes` du contrat), ne pas le relever sans réduire ailleurs ; (2) réduire le maximum de nœuds `challenges` ; (3) arrêter des invités non essentiels.
4. **Après redémarrage de l'hôte** : si la route retour `10.20.0.0/16` via MGMT a disparu, rejouer `task ansible:host`.

## Escalade

Un hôte qui redémarre d'une façon répétée : vérifier le matériel (disques, mémoire) et le journal du noyau avant de relancer la plateforme.

Retour à l'[index des runbooks](index.md).
