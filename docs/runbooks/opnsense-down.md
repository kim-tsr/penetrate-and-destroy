# OPNsense indisponible

OPNsense (VM 200) route toutes les zones. S'il tombe, **toutes les zones sont coupées entre elles et d'Internet** : les autres alertes de disponibilité sont inhibées pour ne pas noyer celle-ci. C'est l'incident le plus grave après l'hôte.

## Symptômes

- `OpnsenseDown` (critique) : plus de métriques du routeur depuis 2 minutes.
- Les sites publics ne répondent plus ; le monitoring ne voit plus les autres zones ; ArgoCD ne joint plus l'API Proxmox.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `OpnsenseDown` | critical | 2m | Le routeur OPNsense ne répond plus |

??? info "Expressions PromQL"

    ```promql
    # OpnsenseDown
    up{job="node", role="router"} == 0
    ```

## Diagnostic

```bash
# Sur l'hôte Proxmox (accès SSH ou console, indépendant de la plateforme)
qm status 200
qm config 200 | grep -E "net|cores|memory|onboot"
tail -50 /var/log/pve/tasks/active 2>/dev/null

# Console de la VM
qm terminal 200          # console série, ou console noVNC depuis l'interface Proxmox
```

## Remédiation

1. **VM arrêtée** : `qm start 200`, attendre 1 à 2 minutes ; les règles sont dans sa configuration, tout revient.
2. **VM démarrée mais sans réseau** : ouvrir la console, vérifier les interfaces (`vtnet0` WAN, `vtnet1` trunk). Redémarrer la VM (`qm reboot 200`).
3. **Configuration perdue ou corrompue** : OPNsense démarre sur sa configuration d'usine. Réimporter la configuration par la procédure manuelle de `infra/opnsense/README.md` (importer au boot, périphérique `cd0`) puis réappliquer les règles : `task tofu:apply-stack STACK=60-opnsense-rules`.
4. **VM irrécupérable** : recréer par tofu, `tofu apply -replace=module.opnsense.proxmox_virtual_environment_vm.this` dans la stack `10-router`, puis `60-opnsense-rules`.
5. **Après récupération** : la cascade d'alertes retombe seule ; vérifier `task verify`.

## Escalade

Pas d'accès à l'hôte = pas de reprise : l'accès à l'hôte Proxmox doit rester fonctionnel en toutes circonstances. Annoncer immédiatement l'incident aux joueurs s'il y a un événement.

Retour à l'[index des runbooks](index.md).
