# Disque saturé

Valable pour l'hôte Proxmox et pour chaque LXC (le label `instance` désigne la machine). Un disque plein arrête les bases de données et les démons Docker.

## Symptômes

- `DiskFull` (moins de 10 % libre), `DiskCritical` (moins de 3 %), `DiskWillFillIn24h` (la tendance des 6 dernières heures épuise le disque d'ici 24 h).
- Erreurs `No space left on device` dans les journaux, services qui ne démarrent plus.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `DiskCritical` | critical | 5m | Disque quasi saturé sur &lt;instance&gt; |
| `DiskFull` | warning | 10m | Disque presque plein sur &lt;instance&gt; |
| `DiskWillFillIn24h` | warning | 1h | Disque plein dans moins de 24 h sur &lt;instance&gt; |

??? info "Expressions PromQL"

    ```promql
    # DiskCritical
    instance:node_filesystem_free:ratio < 0.03
    # DiskFull
    instance:node_filesystem_free:ratio < 0.10
    # DiskWillFillIn24h
    predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs|devtmpfs|fuse.*"}[6h], 24 * 3600) < 0 and instance:node_filesystem_free:ratio < 0.4
    ```

## Diagnostic

```bash
df -hT -x tmpfs -x devtmpfs
du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -20

# Docker (LXC)
docker system df
journalctl --disk-usage

# Spécifique selon le LXC
du -sh /opt/pad/monitoring/* 2>/dev/null          # monitoring : VictoriaMetrics, Loki, Tempo
ls -lh /var/backups/authentik | tail                # authentik : sauvegardes quotidiennes
```

## Remédiation

1. Libérer vite : `docker image prune -a` (images inutilisées), `journalctl --vacuum-size=200M`, anciennes sauvegardes `/var/backups/authentik`.
2. **LXC monitoring** : les données grossissent avec la rétention. Réduire la rétention de VictoriaMetrics, Loki ou Tempo dans le rôle `monitoring-stack`, ou agrandir le disque.
3. **Agrandir le disque d'un LXC** (sur l'hôte) : `pct resize <vmid> rootfs +10G`, puis aligner `disk_gb` dans le contrat pour que tofu ne le ramène pas en arrière.
4. **Hôte Proxmox** : voir [Stockage Proxmox](proxmox-storage.md) (ZFS, snapshots, ISO inutiles).
5. `DiskWillFillIn24h` est un signal d'anticipation : agir sans attendre le seuil.

## Escalade

Un disque critique sur le LXC `authentik` ou sur le stockage ZFS est urgent (risque de corruption de base). Sauvegarder avant toute suppression non triviale.

Retour à l'[index des runbooks](index.md).
