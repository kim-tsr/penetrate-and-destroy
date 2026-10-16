# CrowdSec

**Couche** : Services LXC · **Où** : LXC `edge` (Docker Compose, avec Traefik) · **Version** : v1.8.1 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Analyse le journal d'accès de Traefik, détecte les comportements hostiles (scans, CVE HTTP, force brute) et fait
bannir les adresses par le bouncer de [Traefik](traefik-edge.md). Le composant **AppSec** applique un WAF avec des règles de
« virtual patching ». Choix cohérent avec un front public exposé : protection en bordure sans agent sur chaque service.

## Où elle tourne et comment elle est déployée

Conteneur du Compose `pad-edge`, rôle `edge-traefik-crowdsec`. L'API locale (LAPI, 8080) et AppSec (7422) restent
**internes au réseau Docker** du LXC ; seule la métrique (6060) est publiée sur l'IP du LXC. L'enrôlement au cloud CrowdSec est désactivé.

## Version épinglée

Image `pad_images.crowdsec` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`. Collections installées :
`crowdsecurity/traefik`, `crowdsecurity/http-cve`, `crowdsecurity/appsec-virtual-patching`,
`crowdsecurity/appsec-generic-rules` (liste dans `infra/ansible/roles/edge-traefik-crowdsec/defaults/main.yml`).

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/edge-traefik-crowdsec/templates/crowdsec-acquis-traefik.yaml.j2` et `crowdsec-acquis-appsec.yaml.j2`.
- `.../crowdsec-config.yaml.local.j2`, `crowdsec.env.j2`, `compose.yml.j2`.
- Clé du bouncer : `crowdsec_bouncer_key` dans `secrets/edge.example.yaml` (modèle).

## Interactions avec les autres briques

- Lit `logs/traefik/access.log` (monté en lecture seule) produit par [Traefik edge](traefik-edge.md).
- Reçoit les requêtes à examiner de la part du plugin bouncer (mode `live`).
- Ses métriques sont scrapées par [VictoriaMetrics](victoriametrics.md) (job `crowdsec`).

## Sécurité

- Pas de port LAPI ou AppSec publié hors du réseau Docker.
- `crowdsecAppsecFailureBlock: true` : une requête rejetée par AppSec est bloquée.
- `crowdsecAppsecUnreachableBlock: false` : si AppSec est indisponible, le trafic n'est pas coupé (disponibilité d'abord).
- `no-new-privileges` ; clé du bouncer dans SOPS.

## Supervision

- Alertes `CrowdSecAlertsBurst`, `CrowdSecDecisionsHigh`, `CrowdSecNoMetrics` : [CrowdSec](../runbooks/crowdsec.md).
- Dashboard `pad-security`.

## Opérations courantes

```bash
# sur le LXC edge
docker compose exec crowdsec cscli decisions list
docker compose exec crowdsec cscli metrics
docker compose exec crowdsec cscli decisions delete --ip <adresse>   # débannir
```

## Pièges connus

- Un faux positif banni un joueur derrière une IP partagée : vérifier `cscli decisions list` avant tout.
- Les journaux Traefik sont retenus 7 jours (`access_log_retention_days`).

## Documentation officielle

[docs.crowdsec.net](https://docs.crowdsec.net/)

[Retour à l'index des composants](index.md){ .md-button }
