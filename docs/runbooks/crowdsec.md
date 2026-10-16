# CrowdSec

CrowdSec analyse les journaux de Traefik (et AppSec) sur le LXC `edge` et bannit les sources malveillantes via le bouncer Traefik.

## Symptômes

- `CrowdSecAlertsBurst` : plus de 50 alertes en 15 minutes (scan, brute force, ou faux positifs).
- `CrowdSecDecisionsHigh` : plus de 500 bannissements actifs.
- `CrowdSecNoMetrics` : l'exporter (port 6060) ne répond plus.
- Des joueurs légitimes se plaignent d'être bloqués (403).

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `CrowdSecAlertsBurst` | warning | immédiat | Pic d'alertes CrowdSec (&lt;valeur&gt; en 15 min) |
| `CrowdSecDecisionsHigh` | info | 15m | Plus de 500 bannissements CrowdSec actifs |
| `CrowdSecNoMetrics` | warning | 15m | Les métriques CrowdSec sont absentes |

??? info "Expressions PromQL"

    ```promql
    # CrowdSecAlertsBurst
    sum(increase(cs_alerts[15m])) > 50
    # CrowdSecDecisionsHigh
    sum(cs_active_decisions{action="ban"}) > 500
    # CrowdSecNoMetrics
    absent(cs_active_decisions)
    ```

## Diagnostic

```bash
# LXC edge (vmid 210)
cd /opt/pad/edge
docker compose ps
docker compose exec crowdsec cscli alerts list --since 1h | head -30
docker compose exec crowdsec cscli decisions list | head -30
docker compose exec crowdsec cscli metrics
docker compose exec crowdsec cscli bouncers list
docker compose logs --since 30m crowdsec | tail -30
```

## Remédiation

1. **Attaque réelle** : laisser CrowdSec bannir ; si une source persiste, ajouter une règle au pare-feu (stack `60-opnsense-rules`) plutôt que dans l'interface.
2. **Faux positif** (joueurs NATés derrière une même IP, scanner de vulnérabilités dans un challenge) : `cscli decisions delete --ip <adresse>`, puis ajouter une `whitelist` dans la configuration Ansible du rôle `edge-traefik-crowdsec` pour éviter la récidive.
3. **Pas de métriques** : `docker compose restart crowdsec` ; vérifier que `crowdsec_metrics` (6060) est publié et que la règle M8 de scrape est active.
4. **Bouncer déconnecté** : `cscli bouncers list` doit montrer une activité récente ; sinon redémarrer `traefik`.

## Escalade

Pendant l'événement, les participants tapent beaucoup : un seuil de bannissement trop strict peut gêner les équipes. Ajuster les scénarios plutôt que de désactiver CrowdSec.

Retour à l'[index des runbooks](index.md).
