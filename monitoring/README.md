# Supervision PenetrateAndDestroy

Contenu versionné de la stack de monitoring (VictoriaMetrics, vmalert, Alertmanager, Loki, Tempo, Grafana, Uptime Kuma),
déployée par le rôle Ansible `infra/ansible/roles/monitoring-stack` sur le LXC `monitoring`.

| Chemin | Rôle | Déploiement |
|---|---|---|
| `dashboards/*.json` | Dashboards Grafana (plateforme, live CTF, sécurité, capacité) | copiés dans `config/grafana/dashboards/`, provisionnés par fichier |
| `rules/*.yml` | Recording et alerting rules (format Prometheus/vmalert) | copiées dans `config/vmalert/rules/` |
| `tests/rules/*.test.yml` | Tests unitaires `promtool test rules` | CI uniquement |
| `tests/alertmanager/routes.yml` | Cas de routage Alertmanager (`amtool config routes test`) | CI uniquement |
| `uptime-kuma/` | Sondes déclaratives (`monitors.yml`) et script d'application (`sync.py`) | tâche Ansible optionnelle |
| `scripts/build_dashboards.py` | Générateur des JSON de `dashboards/` | à relancer après modification |
| `scripts/check.sh` | Toutes les validations | CI et poste de dev |

La configuration d'Alertmanager (routes, récepteurs, inhibitions) et ses templates de notification sont dans le rôle
(`templates/alertmanager.yml.j2`, `templates/alertmanager-pad.tmpl.j2`) car ils embarquent des secrets SOPS.

## Valider

```sh
nix develop -c monitoring/scripts/check.sh
```

Le script exécute : validation `jq` et structurelle des dashboards (uid stables `pad-*`, datasources par uid, pas d'import
grafana.com, syntaxe PromQL de chaque requête via `promtool`), conventions des règles (sévérité, annotations, `runbook_url`),
`promtool check rules` et `promtool test rules`, `vmalert -dryRun`, rendu de la config Alertmanager avec des secrets factices
suivi de `amtool check-config` et des tests de routage, plan à blanc des sondes Uptime Kuma, recherche de secrets / IP publiques /
noms d'hôtes réels, et `ansible-lint` (profil `production`). Les outils absents sont signalés `SKIP` ; `PAD_REQUIRE_TOOLS=1` les
rend bloquants. Les binaires `promtool`, `amtool` et `vmalert` ne sont pas encore dans le devshell du `flake.nix` (voir TODO du
rapport) ; ils se surchargent par `PROMTOOL`, `AMTOOL`, `VMALERT`.

## Dashboards

Les JSON sont générés (`python3 monitoring/scripts/build_dashboards.py`) puis commités ; `check.sh` échoue s'ils divergent du
générateur. Datasources provisionnées (uid) : `victoriametrics`, `loki`, `tempo`, `alertmanager`. Dossier Grafana : `PenetrateAndDestroy`.

| uid | Titre | Sources principales |
|---|---|---|
| `pad-platform` | PAD - Plateforme | ArgoCD, kube-state-metrics, cAdvisor, Traefik, logs Loki |
| `pad-live-ctf` | PAD - Live CTF | exporter CTFd, front (`pad_frontend_*`), netbird-sync, spans chall-manager |
| `pad-security` | PAD - Sécurité | CrowdSec, Authentik (Loki), OPNsense, NetBird, Kyverno |
| `pad-capacity` | PAD - Capacité | pve-exporter, node-exporter (ZFS ARC), cluster-autoscaler, KEDA |

Point d'attention : les gauges CTFd et `pad_frontend_active_sessions` sont identiques sur chaque pod ; les agréger avec `max()`
(jamais `sum()`), ce que font les recording rules `pad:*`.

## Règles et alertes

Chaque alerte porte `severity` (`critical`, `warning`, `info`, `none` pour `Watchdog`) et les annotations `summary`,
`description`, `runbook_url`. `runbook_url` est un chemin relatif `docs/runbooks/<nom>.md` que les notifications préfixent par
l'URL du dépôt (`monitoring_stack_runbook_base_url`). Lister les runbooks attendus :

```sh
python3 monitoring/scripts/validate.py runbooks
```

Routage Alertmanager : `critical` -> Discord + e-mail (rappel 1 h) ; `warning` -> Discord (4 h) ; `info` -> Discord, webhook
optionnel distinct (24 h) ; `Watchdog` -> heartbeat Uptime Kuma uniquement ; `none` -> aucune notification. Inhibitions : cible
down, routeur OPNsense HS, variante critique sur variante warning, composant arrêté sur ses symptômes, cluster sans métriques.

## Secrets (jamais dans le dépôt)

Fichier SOPS `secrets/monitoring.sops.yaml` (modèle : `secrets/monitoring.example.yaml`). Clés lues par le rôle :

| Clé | Usage | Obligatoire |
|---|---|---|
| `discord_webhook_url` | récepteurs Discord Alertmanager, notification Uptime Kuma | oui |
| `smtp_smarthost`, `smtp_from`, `smtp_to`, `smtp_username`, `smtp_password` | e-mails des alertes `critical` | oui |
| `discord_webhook_url_info` | canal Discord distinct pour `info` (défaut : `discord_webhook_url`) | non |
| `uptime_kuma_watchdog_token` | jeton (32 caractères alphanumériques) du moniteur push qui reçoit le Watchdog | non |
| `uptime_kuma_username`, `uptime_kuma_password` | compte admin Uptime Kuma, requis seulement si `monitoring_stack_uptime_kuma_sync: true` | non |

## Uptime Kuma

Uptime Kuma n'a pas de fichier de configuration : les sondes sont décrites dans `uptime-kuma/monitors.yml` (URL construites
depuis `infra/contracts.yaml`) et appliquées par `uptime-kuma/sync.py` via l'API (idempotent, clé = nom ; crée le compte admin au
premier lancement, la notification Discord, les groupes, les sondes et la status page `hostnames.status`).

```sh
pip install -r monitoring/uptime-kuma/requirements.txt   # contrôleur Ansible
python3 monitoring/uptime-kuma/sync.py --dry-run          # plan sans connexion
```

Dans le rôle : `monitoring_stack_uptime_kuma_sync: true` (désactivé par défaut) exécute le script depuis le contrôleur. Sans
cela, créer les mêmes sondes à la main dans l'UI à partir de `monitors.yml`. Uptime Kuma tourne sur le même LXC que le
reste de la stack : une panne totale du LXC n'est détectée que par un second point de vue (voir TODO du rapport).

## Dead-man's switch

La règle `Watchdog` est toujours active. Alertmanager l'envoie toutes les 5 minutes au moniteur push « Watchdog Alertmanager »
d'Uptime Kuma, qui alerte si le heartbeat s'arrête (vmalert, Alertmanager ou le LXC HS). Sans `uptime_kuma_watchdog_token`,
le récepteur `watchdog` reste vide et l'alerte n'est visible que dans l'UI Alertmanager.
