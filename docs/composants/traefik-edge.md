# Traefik (edge)

**Couche** : Services LXC · **Où** : LXC `edge` (zone DMZ, 10.20.20.10) · **Version** : v3.7.15 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Seul point d'entrée HTTP(S) public : il termine le TLS (certificat générique ACME DNS-01 via OVH) et route les noms
`front`, `auth`, `vpn` et `status` vers le cluster, Authentik, NetBird et Uptime Kuma. Chaque requête passe par une
chaîne de middlewares : bouncer CrowdSec, limitation de débit, en-têtes de sécurité. La version « cluster » est une autre
brique : [Traefik (cluster)](traefik-cluster.md).

## Où elle tourne et comment elle est déployée

Docker Compose dans le LXC `edge`, posé par le rôle Ansible `edge-traefik-crowdsec` (`/opt/pad/...`). Traefik et
[CrowdSec](crowdsec.md) tournent dans le même Compose. Les ports 80/443 sont publiés ; les métriques (8082) sont liées à l'IP du LXC.
Les ports publics arrivent par le DNAT d'[OPNsense](opnsense.md).

## Version épinglée

- Image : `pad_images.traefik` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml` (`docker.io/library/traefik:v3.7.15@sha256:...`).
- Plugin bouncer : `pad_traefik_plugins.crowdsec_bouncer` = v1.7.1 (même fichier), téléchargé au démarrage.

## Fichiers de configuration dans le dépôt

- `infra/ansible/roles/edge-traefik-crowdsec/templates/traefik.yml.j2` (configuration statique : entrypoints, ACME, plugin).
- `.../dynamic-routers.yml.j2` (routeurs front, status, auth, vpn, vpn-api, vpn-relay, vpn-grpc) et `dynamic-middlewares.yml.j2`.
- `.../compose.yml.j2`, `defaults/main.yml`, `secrets/edge.example.yaml` (jeton OVH, clé du bouncer).

## Interactions avec les autres briques

- Sert le front via l'[ingress du cluster](traefik-cluster.md) (`10.20.60.200`, HTTP), [Authentik](authentik.md) (HTTPS 443),
  [NetBird](netbird.md) (HTTP/h2c) et [Uptime Kuma](uptime-kuma.md).
- Consulte [CrowdSec](crowdsec.md) (LAPI et AppSec) à chaque requête.
- Obtient ses certificats via l'API [OVH](tofu-ovh.md).
- Écrit un journal d'accès lu par CrowdSec ; [Alloy](alloy.md) envoie les logs à Loki.

## Sécurité

- Conteneur Traefik en `read_only`, `cap_drop: ALL` + `NET_BIND_SERVICE`, `no-new-privileges`.
- HSTS 1 an (preload), `frameDeny`, CSP minimale, en-têtes `Server` et `X-Powered-By` vidés.
- Débit : 100 req/s (rafale 200) ; chemin `vpn` : 300 req/s (rafale 600) pour les flux NetBird.
- Redirection 80 vers 443 permanente. Aucun tableau de bord Traefik publié.

## Supervision

- Métriques Prometheus (entrypoint `metrics`, 8082), job `traefik` ; dashboard `pad-platform`.
- Runbooks : [Ingress](../runbooks/ingress.md) (`IngressHigh5xxRatio`, `IngressHighLatency`), [Certificats](../runbooks/certificates.md).

## Opérations courantes

```bash
task ansible:services -- --tags edge --limit edge
# sur le LXC : docker compose -f /opt/pad/edge/compose.yml logs -f traefik   (chemin indicatif)
```
Pour essayer l'ACME sans consommer le quota, renseigner `edge_traefik_crowdsec_acme_ca_server` (CA de test).

## Pièges connus

- Le plugin est téléchargé au démarrage : un LXC sans sortie vers le catalogue de plugins ne démarre pas Traefik correctement.
- `readTimeout: 0s` sur `websecure` est voulu (flux longs gRPC et websocket de NetBird).
- Les CIDR des zones sont de confiance pour le bouncer : ils ne sont jamais bannis.
- Les routeurs dynamiques portent `tls: *pad_tls` (ancre YAML : `certResolver: le`, `main` = domaine, `sans` = `*.domaine`) : un seul certificat wildcard par DNS-01 OVH. Ne jamais remettre `tls: {}` sur un routeur : cela écrase la configuration TLS de l'entrypoint `websecure`, Traefik ne demande alors aucun certificat et sert « TRAEFIK DEFAULT CERT ». Vérifier avec `docker logs pad-edge-traefik-1 | grep lego`.
- Le DNS-01 exige la règle OPNsense `i5-egress-dns` (53 TCP/UDP vers Internet) : lego interroge des résolveurs publics et les serveurs faisant autorité de la zone pour vérifier la propagation.

## Documentation officielle

[doc.traefik.io](https://doc.traefik.io/traefik/)

[Retour à l'index des composants](index.md){ .md-button }

- Le service `cluster-ingress` utilise le transport `cluster@file` (`dialTimeout: 5s`) : si l'ingress du cluster est
  absent (avant la phase 9) ou injoignable, l'edge répond **502** en quelques secondes au lieu de laisser la requête pendue.
