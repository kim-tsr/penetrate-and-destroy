# Invité Proxmox arrêté

Une VM ou un LXC n'est plus en cours d'exécution depuis 5 minutes (labels `name`, `id`).

## Symptômes

- `PveGuestDown` (critique) avec le nom de l'invité.
- Le service correspondant est injoignable (`InstanceDown` associé).

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `PveGuestDown` | critical | 5m | L'invité Proxmox &lt;name&gt; (&lt;id&gt;) est arrêté |

??? info "Expressions PromQL"

    ```promql
    # PveGuestDown
    (pve_up{id=~"(qemu|lxc)/.+"} == 0) * on (id) group_left (name, type) pve_guest_info
    ```

## Diagnostic

```bash
# Sur l'hôte
qm list ; pct list
qm config <vmid>   # ou pct config <vmid>
journalctl -u pve-guests --since "1 hour ago" | tail -30
grep -iE "oom|killed process" /var/log/kern.log | tail      # l'hôte a-t-il tué la VM ?
```

| Invité | vmid | Impact |
|---|---|---|
| OPNsense | 200 | tout est coupé, voir [OPNsense indisponible](opnsense-down.md) |
| edge / netbird | 210 / 211 | plus d'accès public / plus de VPN |
| warpgate / authentik / monitoring | 230 / 240 / 250 | plus de bastion / de SSO / de supervision |
| nœuds Talos | 300 à 399 | voir [Nœuds Kubernetes](kubernetes-nodes.md) |

## Remédiation

1. Démarrer l'invité : `qm start <vmid>` ou `pct start <vmid>`.
2. Démarrage échoué : lire la tâche dans l'interface Proxmox (stockage plein, disque verrouillé par un autre processus, `qm unlock <vmid>` après vérification).
3. Arrêt par manque de mémoire de l'hôte : voir [Hôte Proxmox](proxmox-host.md) avant de redémarrer, sinon le cycle recommence.
4. **Nœud Talos arrêté volontairement par l'autoscaler** (scale-down) : ne pas le relancer ; vérifier d'abord `kubectl -n pad-cluster get machine`.
5. Activer `onboot` sur les invités d'infrastructure pour qu'ils reviennent après un redémarrage de l'hôte (géré par tofu).

## Escalade

Un invité qui s'arrête de façon répétée sans action humaine signale un problème sur l'hôte (mémoire, stockage) : [Hôte Proxmox](proxmox-host.md).

Retour à l'[index des runbooks](index.md).
