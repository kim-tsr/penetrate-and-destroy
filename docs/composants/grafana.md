# Grafana

**Couche** : Observabilité · **Où** : LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose · **Version** : 13.2.4 (image épinglée par digest)

## À quoi elle sert ici et pourquoi ce choix

Interface unique de lecture : quatre dashboards versionnés (`pad-platform`, `pad-live-ctf`, `pad-security`, `pad-capacity`) et
exploration des logs et traces. L'accès est en SSO via [Authentik](authentik.md) (OIDC, PKCE), avec rôles déduits des groupes.

## Où elle tourne et comment elle est déployée

Conteneur du Compose de monitoring (port 3000), exposé en interne (`grafana.<domaine>`, via bastion/forward-auth). Datasources
et dashboards sont **provisionnés par fichiers** : aucune configuration manuelle.

## Version épinglée

`pad_images.grafana` dans `infra/ansible/inventories/prod/group_vars/all/versions.yml`.

## Fichiers de configuration dans le dépôt

- `monitoring/dashboards/*.json`, générés par `monitoring/scripts/build_dashboards.py` (uid stables `pad-*`).
- `infra/ansible/roles/monitoring-stack/templates/grafana-datasources.yml.j2` (uid `victoriametrics`, `loki`, `tempo`, `alertmanager`) et `grafana-dashboards.yml.j2`.
- Variables `GF_AUTH_GENERIC_OAUTH_*` dans `templates/compose.yml.j2`.

## Interactions avec les autres briques

Lit [VictoriaMetrics](victoriametrics.md), [Loki](loki.md), [Tempo](tempo.md) et [Alertmanager](alertmanager.md) ; authentifie via [Authentik](authentik.md).

## Sécurité

- Inscription libre désactivée (`GF_USERS_ALLOW_SIGN_UP=false`), télémétrie et vérification de mise à jour coupées.
- Rôles stricts (`ROLE_ATTRIBUTE_STRICT`) : administrateur = groupe `infra-admins` seulement (`monitoring_stack_grafana_admin_groups`), les autres comptes SSO sont `Viewer`.
- Mot de passe admin et clé de secret dans SOPS (`secrets/monitoring.example.yaml` pour les clés attendues).

## Supervision

Job `grafana` dans VictoriaMetrics. Un dashboard vide : [Pile de supervision](../runbooks/monitoring-stack.md).

## Opérations courantes

```bash
python3 monitoring/scripts/build_dashboards.py   # régénère les JSON
bash monitoring/scripts/check.sh                 # échoue si les JSON divergent du générateur
```

## Pièges connus

- Ne pas éditer les dashboards dans l'UI : ils sont régénérés depuis le script, les modifications seraient perdues.
- Aucun import depuis grafana.com (vérifié par `check.sh`).

## Documentation officielle

[grafana.com/docs/grafana](https://grafana.com/docs/grafana/latest/)

[Retour à l'index des composants](index.md){ .md-button }
