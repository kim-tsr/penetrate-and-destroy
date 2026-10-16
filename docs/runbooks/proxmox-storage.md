# Stockage Proxmox et ZFS

Stockage des disques de VM/LXC (ZFS, datastore `local-zfs`) et cache ARC. Le stockage plein bloque les invités ; un pool dégradé menace les données.

## Symptômes

- `PveStorageHigh` (plus de 80 %) et `PveStorageCritical` (plus de 90 %).
- `ZfsPoolNotOnline` (critique) : un pool est `DEGRADED`, `FAULTED` ou `UNAVAIL`.
- `ZfsArcHitRatioLow` (info) : le cache ARC perd en efficacité.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `PveStorageCritical` | critical | 10m | Stockage Proxmox &lt;id&gt; presque plein (&lt;valeur&gt;) |
| `PveStorageHigh` | warning | 15m | Stockage Proxmox &lt;id&gt; rempli à &lt;valeur&gt; |
| `ZfsArcHitRatioLow` | info | 30m | Taux de réussite du cache ZFS ARC bas (&lt;valeur&gt;) |
| `ZfsPoolNotOnline` | critical | 1m | Pool ZFS &lt;zpool&gt; en état &lt;state&gt; sur &lt;instance&gt; |

??? info "Expressions PromQL"

    ```promql
    # PveStorageCritical
    pad:pve_storage_used:ratio > 0.90
    # PveStorageHigh
    pad:pve_storage_used:ratio > 0.80
    # ZfsArcHitRatioLow
    pad:zfs_arc_hit_ratio:rate5m < 0.70 and rate(node_zfs_arc_hits[5m]) > 100
    # ZfsPoolNotOnline
    node_zfs_zpool_state{state!="online"} == 1
    ```

## Diagnostic

```bash
zpool status -x
zpool list
zfs list -o space -r rpool | sort -k2 -h | tail -20
zfs list -t snapshot -o name,used -s used | tail -10
pvesm status
```

## Remédiation

1. **Pool dégradé** : `zpool status` indique le disque fautif. Remplacer le disque (`zpool replace <pool> <ancien> <nouveau>`) puis suivre le resilver ; ne pas redémarrer pendant l'opération. Prévenir : `zpool scrub` régulier.
2. **Espace faible** : supprimer les snapshots obsolètes, les ISO/templates inutiles (`local:iso`), les disques d'invités détruits. Les sauvegardes locales de `task backup` sont dans `.state/backups` sur le **poste opérateur**, pas sur l'hôte.
3. **Croissance structurelle** : réduire les disques demandés dans le contrat ou ajouter de la capacité.
4. **ARC bas (info)** : l'ensemble de travail dépasse le plafond de 4 Go ; sans impact immédiat. Relever `zfs_arc_max_bytes` seulement si la mémoire de l'hôte le permet (voir [CPU, mémoire, horloge](host-resources.md)).

## Escalade

Un pool `FAULTED` avec perte de redondance est une urgence : arrêter les écritures non essentielles (pause de l'événement) et faire un `task backup` si le cluster est encore joignable.

Retour à l'[index des runbooks](index.md).
