#!/usr/bin/env python3
"""Génère les dashboards Grafana versionnés dans monitoring/dashboards/*.json.

Les JSON sont la source déployée (ils sont commités) ; ce script les rend reproductibles et cohérents
(uid stables, datasources référencées par uid de provisioning, aucun ID grafana.com). Après modification :

    python3 monitoring/scripts/build_dashboards.py
    monitoring/scripts/check.sh

Datasources (uid fixés par le template Ansible grafana-datasources.yml.j2) : victoriametrics, loki, tempo, alertmanager.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "dashboards"

PROM = {"type": "prometheus", "uid": "victoriametrics"}
LOKI = {"type": "loki", "uid": "loki"}
ALERTS = {"type": "alertmanager", "uid": "alertmanager"}

GREEN, ORANGE, RED, BLUE = "green", "orange", "red", "blue"


def steps(*pairs):
    """steps((None,'green'),(80,'orange')) -> liste de seuils Grafana."""
    return [{"color": c, "value": v} for v, c in pairs]


def target(expr, legend="", ref="A", ds=PROM, instant=False, fmt=None, query_type=None):
    t = {"refId": ref, "datasource": ds, "expr": expr, "legendFormat": legend}
    if instant:
        t["instant"] = True
        t["range"] = False
    if fmt:
        t["format"] = fmt
    if query_type:
        t["queryType"] = query_type
    return t


def _targets(exprs, ds=PROM, **kw):
    """Accepte une expr, ou une liste de (expr, légende)."""
    if isinstance(exprs, str):
        exprs = [(exprs, "")]
    return [
        target(e, lg, ref=chr(ord("A") + i), ds=ds, **kw)
        for i, (e, lg) in enumerate(exprs)
    ]


def stat(title, expr, unit="short", w=4, h=4, thresholds=None, desc="", mappings=None,
         color_mode="background", decimals=None, graph=False, text_mode="auto"):
    d = {
        "type": "stat", "title": title, "description": desc, "datasource": PROM,
        "targets": _targets(expr, instant=not graph),
        "fieldConfig": {"defaults": {
            "unit": unit,
            "thresholds": {"mode": "absolute", "steps": thresholds or steps((None, GREEN))},
            "mappings": mappings or [],
            "color": {"mode": "thresholds"},
        }, "overrides": []},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                    "colorMode": color_mode, "graphMode": "area" if graph else "none",
                    "textMode": text_mode, "justifyMode": "auto"},
        "_w": w, "_h": h,
    }
    if decimals is not None:
        d["fieldConfig"]["defaults"]["decimals"] = decimals
    return d


def timeseries(title, exprs, unit="short", w=12, h=8, desc="", ds=PROM, stack=False, minimum=None,
               maximum=None, thresholds=None, fill=15):
    custom = {"drawStyle": "line", "lineWidth": 1, "fillOpacity": fill, "showPoints": "never",
              "spanNulls": True, "stacking": {"mode": "normal" if stack else "none", "group": "A"}}
    defaults = {"unit": unit, "custom": custom, "color": {"mode": "palette-classic"}}
    if minimum is not None:
        defaults["min"] = minimum
    if maximum is not None:
        defaults["max"] = maximum
    if thresholds:
        defaults["thresholds"] = {"mode": "absolute", "steps": thresholds}
        custom["thresholdsStyle"] = {"mode": "line"}
    return {
        "type": "timeseries", "title": title, "description": desc, "datasource": ds,
        "targets": _targets(exprs, ds=ds),
        "fieldConfig": {"defaults": defaults, "overrides": []},
        "options": {"legend": {"displayMode": "table", "placement": "bottom", "calcs": ["lastNotNull", "max"]},
                    "tooltip": {"mode": "multi", "sort": "desc"}},
        "_w": w, "_h": h,
    }


def bargauge(title, expr, legend, unit="short", w=8, h=8, desc="", thresholds=None, maximum=None):
    return {
        "type": "bargauge", "title": title, "description": desc, "datasource": PROM,
        "targets": [target(expr, legend, instant=True)],
        "fieldConfig": {"defaults": {
            "unit": unit, "min": 0, **({"max": maximum} if maximum is not None else {}),
            "thresholds": {"mode": "absolute", "steps": thresholds or steps((None, BLUE))},
            "color": {"mode": "thresholds"},
        }, "overrides": []},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                    "orientation": "horizontal", "displayMode": "gradient", "showUnfilled": True},
        "_w": w, "_h": h,
    }


def table(title, exprs, columns, w=12, h=8, desc="", sort=None, units=None):
    """columns: dict {champ_source: nom affiché} ; les autres champs sont masqués."""
    exclude = {"Time": True}
    rename = {}
    order = {}
    for i, (src, label) in enumerate(columns.items()):
        rename[src] = label
        order[src] = i
    overrides = [
        {"matcher": {"id": "byName", "options": col}, "properties": [{"id": "unit", "value": u}]}
        for col, u in (units or {}).items()
    ]
    return {
        "type": "table", "title": title, "description": desc, "datasource": PROM,
        "targets": _targets(exprs, instant=True, fmt="table"),
        "fieldConfig": {"defaults": {"custom": {"align": "auto"}}, "overrides": overrides},
        "options": {"showHeader": True, "sortBy": [{"displayName": sort[0], "desc": sort[1]}] if sort else []},
        "transformations": [
            {"id": "organize", "options": {"excludeByName": exclude, "renameByName": rename,
                                           "indexByName": order, "includeByName": {}}},
            {"id": "filterFieldsByName", "options": {"include": {"names": list(rename.values())}}},
        ],
        "_w": w, "_h": h,
    }


def logs(title, expr, w=24, h=10, desc=""):
    return {
        "type": "logs", "title": title, "description": desc, "datasource": LOKI,
        "targets": [{"refId": "A", "datasource": LOKI, "expr": expr, "queryType": "range"}],
        "options": {"showTime": True, "wrapLogMessage": True, "sortOrder": "Descending",
                    "enableLogDetails": True, "dedupStrategy": "none"},
        "_w": w, "_h": h,
    }


def text(title, md, w=24, h=3):
    return {"type": "text", "title": title, "options": {"mode": "markdown", "content": md}, "_w": w, "_h": h}


def alertlist(title, w=24, h=8):
    return {
        "type": "alertlist", "title": title,
        "options": {"alertInstanceLabelFilter": "", "alertName": "", "dashboardAlerts": False,
                    "groupBy": [], "groupMode": "default", "maxItems": 20, "sortOrder": 1,
                    "stateFilter": {"firing": True, "pending": True, "noData": False, "normal": False, "error": True},
                    "viewMode": "list", "showInstances": True},
        "_w": w, "_h": h,
    }


def dashboard(uid, title, description, sections, tags=()):
    """sections: liste de (titre_de_rangée, [panneaux]) ; placement automatique sur 24 colonnes."""
    panels, pid, y = [], 1, 0
    for sec_title, items in sections:
        panels.append({"type": "row", "title": sec_title, "collapsed": False, "id": pid,
                       "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []})
        pid += 1
        y += 1
        x, row_h = 0, 0
        for p in items:
            w, h = p.pop("_w"), p.pop("_h")
            if x + w > 24:
                y += row_h
                x, row_h = 0, 0
            p["id"], p["gridPos"] = pid, {"h": h, "w": w, "x": x, "y": y}
            pid += 1
            x += w
            row_h = max(row_h, h)
            panels.append(p)
        y += row_h
    return {
        "uid": uid, "title": title, "description": description,
        "tags": ["pad", *tags], "timezone": "browser", "editable": False, "graphTooltip": 1,
        "schemaVersion": 39, "version": 1, "refresh": "30s",
        "time": {"from": "now-6h", "to": "now"},
        "annotations": {"list": [{
            "builtIn": 1, "enable": True, "hide": True, "iconColor": "rgba(0, 211, 255, 1)",
            "name": "Annotations & Alerts", "type": "dashboard",
            "datasource": {"type": "grafana", "uid": "-- Grafana --"}}]},
        "templating": {"list": []}, "links": [], "panels": panels,
    }


OK_DOWN = [{"type": "value", "options": {"0": {"text": "OK", "color": GREEN}}}]
T_ZERO_RED = steps((None, GREEN), (1, RED))
T_ZERO_ORANGE = steps((None, GREEN), (1, ORANGE))


# --------------------------------------------------------------------------------------- Plateforme
def platform():
    s = []
    s.append(("Santé globale", [
        stat("Applications ArgoCD saines", 'count(argocd_app_info{health_status="Healthy"}) or vector(0)',
             thresholds=steps((None, RED), (1, GREEN))),
        stat("Applications OutOfSync", 'count(argocd_app_info{sync_status="OutOfSync"}) or vector(0)',
             thresholds=T_ZERO_ORANGE, mappings=OK_DOWN),
        stat("Applications Degraded/Missing", 'count(argocd_app_info{health_status=~"Degraded|Missing"}) or vector(0)',
             thresholds=T_ZERO_RED, mappings=OK_DOWN),
        stat("Pods bloqués (hors instances)",
             'sum(kube_pod_status_phase{phase=~"Pending|Unknown|Failed", namespace!~"inst-.+"}) or vector(0)',
             thresholds=T_ZERO_ORANGE, mappings=OK_DOWN),
        stat("Nœuds Ready", 'sum(kube_node_status_condition{condition="Ready", status="true"}) or vector(0)',
             thresholds=steps((None, RED), (1, GREEN))),
        stat("Cibles de scrape en échec", 'count(up{job!~"kubelet|cadvisor"} == 0) or vector(0)',
             thresholds=T_ZERO_RED, mappings=OK_DOWN),
        alertlist("Alertes en cours"),
    ]))
    s.append(("Applications ArgoCD", [
        table("État des Applications", 'argocd_app_info',
              {"name": "Application", "project": "Projet", "sync_status": "Sync",
               "health_status": "Santé", "dest_namespace": "Namespace"},
              w=14, h=9, sort=("Santé", False)),
        timeseries("Synchronisations par phase (1 h)",
                   'sum by (phase) (increase(argocd_app_sync_total[1h]))', w=10, h=9, stack=True),
    ]))
    s.append(("Pods et nœuds", [
        timeseries("Pods par phase",
                   [('sum by (phase) (kube_pod_status_phase{namespace!~"inst-.+"})', "{{phase}}")], w=8, stack=True),
        timeseries("Redémarrages de conteneurs (15 min)",
                   [('topk(10, sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[15m])) > 0)',
                     "{{namespace}}/{{pod}}")], w=8),
        timeseries("Deployments indisponibles",
                   [('kube_deployment_spec_replicas{namespace!~"inst-.+"} - kube_deployment_status_replicas_available{namespace!~"inst-.+"} > 0',
                     "{{namespace}}/{{deployment}}")], w=8),
        timeseries("CPU par namespace (cœurs)",
                   [('sum by (namespace) (rate(container_cpu_usage_seconds_total{container!="", namespace!~"inst-.+"}[5m]))',
                     "{{namespace}}")], unit="short", w=12, stack=True),
        timeseries("Mémoire par namespace",
                   [('sum by (namespace) (container_memory_working_set_bytes{container!="", namespace!~"inst-.+"})',
                     "{{namespace}}")], unit="bytes", w=12, stack=True),
    ]))
    s.append(("Ingress Traefik (cluster)", [
        timeseries("Requêtes par code (req/s)", [("pad:traefik_requests:rate5m", "{{code}}")], unit="reqps", w=8, stack=True),
        timeseries("Taux de 5xx", [("pad:traefik_5xx_ratio:rate5m", "5xx")], unit="percentunit", w=8,
                   thresholds=steps((None, GREEN), (0.05, RED)), minimum=0),
        timeseries("Latence p95", [("pad:traefik_request_duration_seconds:p95_5m", "p95")], unit="s", w=8,
                   thresholds=steps((None, GREEN), (2, RED)), minimum=0),
        bargauge("Top services (req/s)", 'topk(8, sum by (service) (rate(traefik_service_requests_total[5m])))',
                 "{{service}}", unit="reqps", w=12),
        table("Certificats servis (expiration)", 'traefik_tls_certs_not_after - time()',
              {"cn": "CN", "instance": "Traefik", "Value": "Expire dans"}, w=12,
              sort=("Expire dans", False), units={"Expire dans": "s"}),
    ]))
    s.append(("Logs", [
        timeseries("Erreurs dans les logs du cluster (5 min)",
                   [('sum by (namespace) (count_over_time({cluster="pad-prod"} |~ "(?i)(error|panic|fatal)" [5m]))',
                     "{{namespace}}")], ds=LOKI, w=24, stack=True),
        logs("Logs d'erreur récents", '{cluster="pad-prod"} |~ "(?i)(error|panic|fatal)"'),
    ]))
    return dashboard("pad-platform", "PAD - Plateforme", "Santé des Applications ArgoCD, pods, nœuds et ingress Traefik.",
                     s, ("plateforme",))


# --------------------------------------------------------------------------------------- Live CTF
def live_ctf():
    s = []
    s.append(("En direct", [
        stat("Joueurs actifs (5 min)", 'pad:ctfd_active_users{window="5m"}', w=4, thresholds=steps((None, BLUE))),
        stat("Sessions du front", "pad:frontend_active_sessions", w=4, thresholds=steps((None, BLUE)),
             desc="pad_frontend_active_sessions : valeur globale (max sur les pods, jamais sum)."),
        stat("Équipes", "pad:ctfd_teams:total", w=4, thresholds=steps((None, BLUE))),
        stat("Joueurs inscrits", "pad:ctfd_users:total", w=4, thresholds=steps((None, BLUE))),
        stat("Instances actives", "pad:instances_active", w=4, thresholds=steps((None, BLUE))),
        stat("Soumissions / min", "pad:ctfd_submissions_per_minute", w=4, decimals=1, thresholds=steps((None, BLUE))),
        stat("Solves", "pad:ctfd_solves:total", w=4, thresholds=steps((None, GREEN))),
        stat("Challenges avec first blood", "pad:ctfd_first_bloods:total", w=4, thresholds=steps((None, GREEN))),
        stat("Challenges publiés", 'sum(max by (state, type, category) (ctfd_challenges{state="visible"}))', w=4,
             thresholds=steps((None, BLUE))),
        stat("État de l'événement", [('max by (state) (ctfd_event_state) == 1', "{{state}}")], w=4,
             color_mode="value", text_mode="name",
             desc="running, paused, frozen, ended ou not_started (label state de ctfd_event_state)."),
        stat("Équipes bannies", 'max(ctfd_teams{kind="banned"})', w=4, thresholds=T_ZERO_ORANGE),
        stat("Exporter CTFd à jour", 'time() - max(ctfd_metrics_generated_timestamp_seconds)', unit="s", w=4,
             thresholds=steps((None, GREEN), (120, ORANGE), (300, RED))),
    ]))
    s.append(("Activité", [
        timeseries("Joueurs actifs par fenêtre", [("pad:ctfd_active_users", "{{window}}")], w=8, fill=0),
        timeseries("Sessions actives du front et flux SSE",
                   [("pad:frontend_active_sessions", "sessions"),
                    ("sum(pad_frontend_sse_clients)", "connexions SSE")], w=8, fill=0),
        timeseries("Soumissions par minute",
                   [("60 * pad:ctfd_submissions:rate5m", "{{result}}")], w=8, stack=True),
        timeseries("Solves par minute", [("pad:ctfd_solves_per_minute", "solves/min")], w=8),
        timeseries("Soumissions de flags via le front (par minute)",
                   [("60 * sum by (result) (rate(pad_frontend_flag_submissions_total[5m]))", "{{result}}")], w=8,
                   stack=True),
        timeseries("Instances actives (CTFd) vs namespaces du cluster",
                   [("pad:instances_active", "actives selon CTFd"),
                    ("pad:instances_namespaces", "namespaces inst-*")], w=8, fill=0),
    ]))
    s.append(("Challenges", [
        bargauge("Solves par challenge",
                 'topk(15, max by (challenge) (ctfd_challenge_solves))', "{{challenge}}", w=12, h=10),
        table("First bloods",
              'ctfd_challenge_first_blood_timestamp_seconds * 1000',
              {"challenge": "Challenge", "category": "Catégorie", "account": "Équipe / joueur",
               "Value": "Date"}, w=12, h=10, sort=("Date", True), units={"Date": "dateTimeAsLocal"}),
        timeseries("First bloods dans la dernière heure",
                   [("count(max by (challenge_id) (ctfd_challenge_first_blood_timestamp_seconds) > (time() - 3600)) or vector(0)",
                     "first bloods (1 h)")], w=12, fill=0),
        timeseries("Solves cumulés", [("pad:ctfd_solves:total", "solves")], w=12, fill=0),
    ]))
    s.append(("Santé du front", [
        timeseries("Requêtes du front par statut", [("pad:frontend_http_requests:rate5m", "{{status}}")], unit="reqps",
                   w=8, stack=True),
        timeseries("Latence BFF -> CTFd (p95)", [("pad:frontend_ctfd_request_duration_seconds:p95_5m", "p95")],
                   unit="s", w=8, thresholds=steps((None, GREEN), (2, RED)), minimum=0),
        timeseries("Taux de 5xx du front", [("pad:frontend_http_5xx_ratio:rate5m", "5xx")], unit="percentunit", w=8,
                   thresholds=steps((None, GREEN), (0.05, RED)), minimum=0),
    ]))
    s.append(("Instances et NetBird", [
        timeseries("Réconciliations netbird-sync",
                   [("sum by (result) (rate(netbird_sync_reconcile_total[5m]))", "{{result}}")], unit="ops", w=8,
                   stack=True),
        timeseries("Erreurs netbird-sync", [("rate(netbird_sync_reconcile_errors_total[5m])", "erreurs/s")],
                   unit="ops", w=8, thresholds=steps((None, GREEN), (0.0001, RED))),
        timeseries("Appels chall-manager (spans/s)",
                   [('sum by (span_name) (rate(traces_spanmetrics_calls_total{service="chall-manager"}[5m]))',
                     "{{span_name}}")], unit="ops", w=8, stack=True,
                   desc="Métriques de spans générées par Tempo (service OTLP chall-manager)."),
    ]))
    return dashboard("pad-live-ctf", "PAD - Live CTF",
                     "Joueurs, équipes, solves, first bloods, instances, soumissions et sessions du front pendant l'événement.",
                     s, ("ctf",))


# --------------------------------------------------------------------------------------- Sécurité
def security():
    s = []
    s.append(("CrowdSec (edge)", [
        stat("Bans actifs", 'sum(cs_active_decisions{action="ban"}) or vector(0)', w=6,
             thresholds=steps((None, GREEN), (200, ORANGE), (500, RED))),
        stat("Alertes (1 h)", "sum(increase(cs_alerts[1h])) or vector(0)", w=6, decimals=0,
             thresholds=steps((None, GREEN), (50, ORANGE), (200, RED))),
        timeseries("Décisions actives par origine", [("sum by (origin, action) (cs_active_decisions)", "{{origin}} / {{action}}")],
                   w=12, stack=True),
        timeseries("Alertes par scénario (15 min)",
                   [("topk(10, sum by (reason) (increase(cs_alerts[15m])))", "{{reason}}")], w=12),
        timeseries("Buckets débordés par scénario (15 min)",
                   [("topk(10, sum by (name) (increase(cs_bucket_overflowed_total[15m])))", "{{name}}")], w=12),
    ]))
    s.append(("Authentik", [
        stat("Connexions échouées (1 h)",
             'sum(count_over_time({compose_project="authentik", service="server"} |= "login_failed" [1h]))',
             w=6, thresholds=steps((None, GREEN), (20, ORANGE), (100, RED)),
             desc="Source : logs JSON d'Authentik (événement login_failed) via Loki ; pas de métrique Prometheus native.")
        | {"datasource": LOKI, "targets": [target(
            'sum(count_over_time({compose_project="authentik", service="server"} |= "login_failed" [1h]))',
            ds=LOKI, instant=True, query_type="instant")]},
        timeseries("Connexions échouées (5 min)",
                   [('sum(count_over_time({compose_project="authentik", service="server"} |= "login_failed" [5m]))',
                     "login_failed")], ds=LOKI, w=18, fill=20),
        timeseries("Réponses HTTP 5xx d'Authentik", [('sum by (status) (rate(django_http_responses_total_by_status_total{job="authentik", status=~"5.."}[5m]))', "{{status}}")],
                   unit="reqps", w=12),
        timeseries("Latence des requêtes Authentik (p95)",
                   [('histogram_quantile(0.95, sum by (le) (rate(django_http_requests_latency_seconds_by_view_method_bucket{job="authentik"}[5m])))', "p95")],
                   unit="s", w=12),
        logs("Événements de connexion échouée", '{compose_project="authentik", service="server"} |= "login_failed"'),
    ]))
    s.append(("OPNsense (pare-feu)", [
        stat("Routeur joignable", 'min(up{job="node", role="router"})', w=6,
             mappings=[{"type": "value", "options": {"0": {"text": "HORS LIGNE", "color": RED},
                                                     "1": {"text": "OK", "color": GREEN}}}],
             thresholds=steps((None, RED), (1, GREEN))),
        timeseries("Trafic des interfaces du routeur",
                   [('sum by (device) (rate(node_network_receive_bytes_total{role="router", device!~"lo|pflog.*|pfsync.*|enc.*"}[5m]))', "rx {{device}}"),
                    ('-sum by (device) (rate(node_network_transmit_bytes_total{role="router", device!~"lo|pflog.*|pfsync.*|enc.*"}[5m]))', "tx {{device}}")],
                   unit="Bps", w=18),
        timeseries("Paquets bloqués (logs de filtrage)",
                   [('sum(count_over_time({job="opnsense"} |~ "(?i)block" [5m]))', "blocks")], ds=LOKI, w=12,
                   desc="Nécessite le syslog OPNsense vers Alloy/Loki (label job=opnsense), non provisionné à ce jour."),
        logs("Journal de filtrage OPNsense", '{job="opnsense"} |~ "(?i)block"', w=12),
    ]))
    s.append(("NetBird", [
        stat("Peers connectés", "max(management_account_peers_count)", w=6, thresholds=steps((None, BLUE)),
             desc="Métrique du serveur de management NetBird (port ports.netbird.metrics)."),
        stat("Serveur NetBird joignable", 'min(up{job="netbird"})', w=6,
             mappings=[{"type": "value", "options": {"0": {"text": "HORS LIGNE", "color": RED},
                                                     "1": {"text": "OK", "color": GREEN}}}],
             thresholds=steps((None, RED), (1, GREEN))),
        timeseries("Peers dans le temps", [("max(management_account_peers_count)", "peers")], w=12, fill=0),
        timeseries("Synchronisation des instances (netbird-sync)",
                   [("sum by (result) (increase(netbird_sync_reconcile_total[15m]))", "{{result}}")], w=12, stack=True),
    ]))
    s.append(("Kyverno (admission)", [
        stat("Violations (1 h)", 'sum(increase(kyverno_policy_results_total{rule_result="fail"}[1h])) or vector(0)',
             w=6, decimals=0, thresholds=steps((None, GREEN), (1, ORANGE), (50, RED))),
        timeseries("Violations par politique (15 min)",
                   [('sum by (policy_name) (increase(kyverno_policy_results_total{rule_result="fail"}[15m]))', "{{policy_name}}")],
                   w=18, stack=True),
        table("Violations par politique et namespace (24 h)",
              'sum by (policy_name, resource_namespace) (increase(kyverno_policy_results_total{rule_result="fail"}[24h])) > 0',
              {"policy_name": "Politique", "resource_namespace": "Namespace", "Value": "Violations"}, w=24,
              sort=("Violations", True)),
    ]))
    return dashboard("pad-security", "PAD - Sécurité",
                     "CrowdSec, Authentik, OPNsense, NetBird et Kyverno.", s, ("securite",))


# --------------------------------------------------------------------------------------- Capacité
def capacity():
    s = []
    s.append(("Hôte Proxmox", [
        stat("CPU de l'hôte", 'max(pve_cpu_usage_ratio{id=~"node/.+"})', unit="percentunit", w=4,
             thresholds=steps((None, GREEN), (0.7, ORANGE), (0.9, RED))),
        stat("Mémoire de l'hôte", 'max(pve_memory_usage_bytes{id=~"node/.+"} / pve_memory_size_bytes{id=~"node/.+"})',
             unit="percentunit", w=4, thresholds=steps((None, GREEN), (0.8, ORANGE), (0.92, RED))),
        stat("ZFS ARC / plafond", "max(pad:zfs_arc_size:ratio)", unit="percentunit", w=4,
             thresholds=steps((None, BLUE))),
        stat("Hit ratio ARC", "min(pad:zfs_arc_hit_ratio:rate5m)", unit="percentunit", w=4,
             thresholds=steps((None, RED), (0.7, ORANGE), (0.9, GREEN))),
        stat("Invités arrêtés", 'count(pve_up{id=~"(qemu|lxc)/.+"} == 0) or vector(0)', w=4,
             thresholds=T_ZERO_RED, mappings=OK_DOWN),
        stat("Pools ZFS non online", 'count(node_zfs_zpool_state{state!="online"} == 1) or vector(0)', w=4,
             thresholds=T_ZERO_RED, mappings=OK_DOWN),
        bargauge("Occupation des stockages Proxmox", 'pad:pve_storage_used:ratio', "{{id}}", unit="percentunit",
                 w=8, thresholds=steps((None, GREEN), (0.8, ORANGE), (0.9, RED)), maximum=1),
        bargauge("CPU des invités (VM/LXC)",
                 'topk(10, pve_cpu_usage_ratio{id=~"(qemu|lxc)/.+"} * on (id) group_left (name) pve_guest_info)',
                 "{{name}}", unit="percentunit", w=8, thresholds=steps((None, GREEN), (0.7, ORANGE), (0.9, RED))),
        bargauge("Mémoire des invités",
                 'topk(10, pve_memory_usage_bytes{id=~"(qemu|lxc)/.+"} * on (id) group_left (name) pve_guest_info)',
                 "{{name}}", unit="bytes", w=8),
        timeseries("ZFS ARC : taille et plafond",
                   [("node_zfs_arc_size", "taille"), ("node_zfs_arc_c_max", "plafond (zfs_arc_max)"),
                    ("node_zfs_arc_c", "cible")], unit="bytes", w=12, fill=0),
        timeseries("ZFS ARC : hit ratio et débit", [("pad:zfs_arc_hit_ratio:rate5m", "hit ratio")],
                   unit="percentunit", w=12, fill=0, minimum=0, maximum=1),
    ]))
    s.append(("LXC de services et routeur", [
        timeseries("CPU par hôte", [("instance:node_cpu_used:ratio5m", "{{instance}}")], unit="percentunit", w=8,
                   minimum=0, maximum=1),
        timeseries("Mémoire par hôte", [("instance:node_memory_used:ratio", "{{instance}}")], unit="percentunit",
                   w=8, minimum=0, maximum=1),
        timeseries("Espace disque libre (minimum par hôte)",
                   [("min by (instance) (instance:node_filesystem_free:ratio)", "{{instance}}")],
                   unit="percentunit", w=8, minimum=0, maximum=1, thresholds=steps((None, RED), (0.1, GREEN))),
        timeseries("Volumétrie VictoriaMetrics",
                   [('vm_data_size_bytes{type=~"storage/.*"}', "{{type}}")], unit="bytes", w=12, stack=True),
        timeseries("Série actives et débit d'insertion",
                   [("vm_cache_entries{type=\"storage/hour_metric_ids\"}", "séries actives (heure)"),
                    ("sum(rate(vm_rows_inserted_total[5m]))", "lignes/s")], w=12, fill=0),
    ]))
    s.append(("Cluster Kubernetes", [
        timeseries("CPU : demandes, limites et usage (cluster)",
                   [('sum(kube_pod_container_resource_requests{resource="cpu"})', "requests"),
                    ('sum(kube_pod_container_resource_limits{resource="cpu"})', "limits"),
                    ('sum(kube_node_status_allocatable{resource="cpu"})', "allouable"),
                    ('sum(rate(container_cpu_usage_seconds_total{container!=""}[5m]))', "usage")],
                   w=12, fill=0),
        timeseries("Mémoire : demandes, limites et usage (cluster)",
                   [('sum(kube_pod_container_resource_requests{resource="memory"})', "requests"),
                    ('sum(kube_pod_container_resource_limits{resource="memory"})', "limits"),
                    ('sum(kube_node_status_allocatable{resource="memory"})', "allouable"),
                    ('sum(container_memory_working_set_bytes{container!=""})', "usage")],
                   unit="bytes", w=12, fill=0),
        timeseries("Pods par nœud / capacité",
                   [("sum by (node) (kube_pod_info)", "{{node}}"),
                    ('max(kube_node_status_capacity{resource="pods"})', "capacité")], w=8, fill=0),
        timeseries("Occupation des PVC", [("1 - kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes",
                                            "{{namespace}}/{{persistentvolumeclaim}}")],
                   unit="percentunit", w=8, minimum=0, maximum=1),
        timeseries("Pods d'instances de challenges", [('sum(kube_pod_status_phase{namespace=~"inst-.+", phase="Running"})', "running"),
                                                      ("pad:instances_namespaces", "namespaces")], w=8, fill=0),
    ]))
    s.append(("Autoscaling : cluster-autoscaler et KEDA", [
        timeseries("Nœuds par état (cluster-autoscaler)",
                   [("sum by (state) (cluster_autoscaler_nodes_count)", "{{state}}")], w=8, stack=True),
        timeseries("Pods non planifiables", [("cluster_autoscaler_unschedulable_pods_count", "en attente")],
                   w=8, thresholds=steps((None, GREEN), (1, ORANGE))),
        timeseries("Scale up / scale down (nœuds, 1 h)",
                   [("increase(cluster_autoscaler_scaled_up_nodes_total[1h])", "ajoutés"),
                    ("increase(cluster_autoscaler_scaled_down_nodes_total[1h])", "retirés"),
                    ("increase(cluster_autoscaler_failed_scale_ups_total[1h])", "échecs")], w=8),
        timeseries("Réplicas des HPA (KEDA)",
                   [("kube_horizontalpodautoscaler_status_current_replicas", "{{namespace}}/{{horizontalpodautoscaler}}"),
                    ("kube_horizontalpodautoscaler_spec_max_replicas", "max {{namespace}}/{{horizontalpodautoscaler}}")],
                   w=12, fill=0),
        timeseries("Valeur des scalers KEDA",
                   [("keda_scaler_metrics_value", "{{namespace}}/{{scaledObject}} {{metric}}")], w=6, fill=0),
        timeseries("Erreurs des scalers KEDA (10 min)",
                   [("sum by (scaledObject) (increase(keda_scaler_detail_errors_total[10m]))", "{{scaledObject}}")], w=6,
                   thresholds=steps((None, GREEN), (1, RED))),
    ]))
    return dashboard("pad-capacity", "PAD - Capacité",
                     "Capacité du cluster et de l'hôte Proxmox : pve-exporter, ZFS ARC, autoscaler, KEDA.",
                     s, ("capacite",))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in (("platform", platform), ("live-ctf", live_ctf), ("security", security), ("capacity", capacity)):
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(fn(), indent=2, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")
        print(f"écrit {path.relative_to(OUT.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
