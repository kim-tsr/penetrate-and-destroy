# Nœuds Kubernetes

Nœuds Talos du cluster `pad-prod` : un control plane, deux workers `platform`, 1 à 3 workers `challenges`. Pas de SSH : on utilise `talosctl` (API Talos, port 50000, depuis le bastion).

## Symptômes

- `KubeNodeNotReady` (critique) : un nœud est NotReady.
- `KubeNodePressure` : MemoryPressure, DiskPressure ou PIDPressure.
- Des pods sont évincés ou restent Pending.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `KubeNodeNotReady` | critical | 5m | Nœud Kubernetes &lt;node&gt; NotReady |
| `KubeNodePressure` | warning | 10m | Nœud &lt;node&gt; sous pression (&lt;condition&gt;) |

??? info "Expressions PromQL"

    ```promql
    # KubeNodeNotReady
    kube_node_status_condition{condition="Ready", status="true"} == 0
    # KubeNodePressure
    kube_node_status_condition{condition=~"MemoryPressure|DiskPressure|PIDPressure", status="true"} == 1
    ```

## Diagnostic

```bash
export KUBECONFIG="$PWD/.state/kubeconfig" TALOSCONFIG="$PWD/.state/talosconfig"
kubectl get nodes -o wide
kubectl describe node <noeud> | sed -n '/Conditions/,/Addresses/p;/Events/,$p'

# Côté Talos
talosctl -n <ip-noeud> health --server=false
talosctl -n <ip-noeud> service kubelet
talosctl -n <ip-noeud> dmesg | tail -40
talosctl -n <ip-noeud> df

# Côté Cluster API et Proxmox
kubectl -n pad-cluster get machine -o wide
qm status <vmid>          # sur l'hôte
```

## Remédiation

1. **VM arrêtée** : la démarrer (`qm start <vmid>`) ; voir [Invité Proxmox arrêté](proxmox-guest-down.md).
2. **kubelet en erreur** : `talosctl service kubelet restart` ; sinon lire `dmesg` (réseau, disque).
3. **DiskPressure** : `talosctl df`, `talosctl usage /var`. Images et journaux sont les causes courantes ; Talos purge les images inutilisées ; agrandir le disque du pool dans le contrat si c'est structurel.
4. **MemoryPressure** : trop de pods ou de limites mal posées ; voir [Charges Kubernetes](kubernetes-workloads.md).
5. **Nœud définitivement perdu** : supprimer sa `Machine` (`kubectl -n pad-cluster delete machine <nom>`) ; la MachineSet en recrée une. Pour le **control plane**, ne pas supprimer sans sauvegarde : il n'y a qu'un seul réplica (voir [limites](../reference/limites.md)).

## Escalade

La perte du control plane unique rend l'API Kubernetes indisponible mais ne coupe pas les workloads existants. Reconstruction : [Reconstruire](rebuild.md) en dernier recours.

Retour à l'[index des runbooks](index.md).
