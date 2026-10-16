#!/usr/bin/env python3
"""Applique monitors.yml sur Uptime Kuma 2.x (API Socket.IO via uptime-kuma-api-v2), de façon idempotente.

Usage :
    sync.py --dry-run                      # valide et affiche le plan, sans réseau ni dépendance Uptime Kuma
    sync.py --url http://HOTE:3001         # applique (UPTIME_KUMA_USERNAME / UPTIME_KUMA_PASSWORD requis)

Les secrets arrivent uniquement par variables d'environnement (voir monitors.yml). Le script affiche une ligne
« CHANGED: ... » par modification effectuée, ce qu'Ansible utilise pour changed_when.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VALID_TYPES = {"http", "port", "push", "group"}
# Champs comparés entre l'état souhaité et l'état existant (clé Python de l'API).
COMPARED = ("url", "hostname", "port", "interval", "retryInterval", "maxretries", "accepted_statuscodes",
            "expiryNotification", "parent")


class Config:
    """Rend monitors.yml avec les valeurs de infra/contracts.yaml et valide sa structure."""

    def __init__(self, contracts: dict, spec: dict, env: dict):
        self.contracts, self.spec, self.env = contracts, spec, env

    def render(self, value):
        if isinstance(value, str):
            try:
                return value.format(**self.contracts)
            except (KeyError, IndexError) as exc:
                raise SystemExit(f"placeholder inconnu {exc} dans « {value} » (absent de infra/contracts.yaml)")
        if isinstance(value, list):
            return [self.render(v) for v in value]
        return value

    def monitors(self) -> list[dict]:
        defaults = self.spec.get("defaults", {})
        names, out = set(), []
        for raw in self.spec.get("monitors", []):
            m = {**defaults, **raw}
            if m.get("type") not in VALID_TYPES - {"group"}:
                raise SystemExit(f"type de sonde invalide « {m.get('type')} » pour « {m.get('name')} »")
            if not m.get("name") or m["name"] in names:
                raise SystemExit(f"nom de sonde manquant ou dupliqué : {m.get('name')!r}")
            names.add(m["name"])
            for key in ("name", "group", "url", "hostname", "port"):
                if key in m:
                    m[key] = self.render(m[key])
            if m["type"] == "http" and not m.get("url"):
                raise SystemExit(f"« {m['name']} » : url requise")
            if m["type"] == "port" and not (m.get("hostname") and m.get("port")):
                raise SystemExit(f"« {m['name']} » : hostname et port requis")
            if m["type"] == "push" and not m.get("token_env"):
                raise SystemExit(f"« {m['name']} » : token_env requis pour une sonde push")
            if "port" in m:
                m["port"] = int(m["port"])
            out.append(m)
        return out

    def notifications(self) -> list[dict]:
        out = []
        for n in self.spec.get("notifications", []):
            if n.get("type") != "discord" or not n.get("webhook_env"):
                raise SystemExit(f"notification non gérée : {n}")
            out.append(n)
        return out

    def status_page(self) -> dict | None:
        sp = self.spec.get("status_page")
        if not sp:
            return None
        return {**sp, "domains": self.render(sp.get("domains", []))}


def load(args) -> Config:
    contracts = yaml.safe_load(Path(args.contracts).read_text(encoding="utf-8"))
    spec = yaml.safe_load(Path(args.monitors).read_text(encoding="utf-8"))
    return Config(contracts, spec, os.environ)


def desired_kwargs(m: dict, group_ids: dict, notif_ids: dict, env: dict) -> dict:
    """Arguments de l'API Uptime Kuma pour une sonde."""
    from uptime_kuma_api import MonitorType  # import tardif : inutile en dry-run

    kw = {
        "type": {"http": MonitorType.HTTP, "port": MonitorType.PORT, "push": MonitorType.PUSH}[m["type"]],
        "name": m["name"],
        "interval": int(m.get("interval", 60)),
        "retryInterval": int(m.get("retry_interval", 30)),
        "maxretries": int(m.get("max_retries", 3)),
        "notificationIDList": {str(i): True for i in notif_ids.values()},
    }
    if m["type"] == "http":
        kw["url"] = m["url"]
        kw["accepted_statuscodes"] = m.get("accepted_status_codes", ["200-299"])
        kw["expiryNotification"] = bool(m.get("expiry_notification")) and m["url"].startswith("https://")
    elif m["type"] == "port":
        kw["hostname"], kw["port"] = m["hostname"], m["port"]
    elif m["type"] == "push":
        token = env.get(m["token_env"], "")
        if not re.fullmatch(r"[A-Za-z0-9]{16,64}", token):
            raise SystemExit(f"{m['token_env']} absent ou invalide (16 à 64 caractères alphanumériques) pour « {m['name']} »")
        kw["pushToken"] = token
    if m.get("group"):
        kw["parent"] = group_ids[m["group"]]
    return kw


def dry_run(cfg: Config) -> int:
    print("# Plan (dry-run) - aucune connexion à Uptime Kuma")
    for n in cfg.notifications():
        print(f"notification  {n['name']:<28} discord (webhook via ${n['webhook_env']})")
    for m in cfg.monitors():
        target = m.get("url") or f"{m.get('hostname')}:{m.get('port')}" if m["type"] != "push" else f"${m['token_env']}"
        print(f"sonde         {m['name']:<28} {m['type']:<5} [{m.get('group', '-')}] {target}")
    sp = cfg.status_page()
    if sp:
        print(f"status page   {sp['slug']} -> {', '.join(sp['domains'])} (groupes : {', '.join(sp.get('groups', []))})")
    return 0


def apply(cfg: Config, url: str) -> int:
    from uptime_kuma_api import NotificationType, UptimeKumaApi

    user, password = os.environ.get("UPTIME_KUMA_USERNAME"), os.environ.get("UPTIME_KUMA_PASSWORD")
    if not user or not password:
        raise SystemExit("UPTIME_KUMA_USERNAME et UPTIME_KUMA_PASSWORD sont requis")
    changed = 0
    api = UptimeKumaApi(url, timeout=30)
    try:
        if api.need_setup():
            api.setup(user, password)
            print("CHANGED: compte administrateur initialisé")
            changed += 1
        api.login(user, password)

        # --- Notifications ---
        notif_ids, existing = {}, {n["name"]: n for n in api.get_notifications()}
        for n in cfg.notifications():
            webhook = os.environ.get(n["webhook_env"], "")
            if not webhook:
                raise SystemExit(f"{n['webhook_env']} est vide")
            params = {"name": n["name"], "type": NotificationType.DISCORD, "discordWebhookUrl": webhook,
                      "isDefault": bool(n.get("default")), "applyExisting": bool(n.get("apply_existing"))}
            if n["name"] in existing:
                notif_ids[n["name"]] = existing[n["name"]]["id"]
                if webhook not in str(existing[n["name"]].get("config", "")):
                    api.edit_notification(notif_ids[n["name"]], **params)
                    print(f"CHANGED: notification {n['name']} mise à jour")
                    changed += 1
            else:
                notif_ids[n["name"]] = api.add_notification(**params)["id"]
                print(f"CHANGED: notification {n['name']} créée")
                changed += 1

        # --- Groupes ---
        from uptime_kuma_api import MonitorType

        monitors = {m["name"]: m for m in api.get_monitors()}
        group_ids = {}
        for g in sorted({m["group"] for m in cfg.monitors() if m.get("group")}):
            if g in monitors:
                group_ids[g] = monitors[g]["id"]
            else:
                group_ids[g] = api.add_monitor(type=MonitorType.GROUP, name=g)["monitorID"]
                print(f"CHANGED: groupe {g} créé")
                changed += 1

        # --- Sondes ---
        monitor_ids = {}
        for m in cfg.monitors():
            kw = desired_kwargs(m, group_ids, notif_ids, os.environ)
            cur = monitors.get(m["name"])
            if cur is None:
                monitor_ids[m["name"]] = api.add_monitor(**kw)["monitorID"]
                print(f"CHANGED: sonde {m['name']} créée")
                changed += 1
                continue
            monitor_ids[m["name"]] = cur["id"]
            diff = [k for k in COMPARED if k in kw and cur.get(k) != kw[k]]
            if diff:
                api.edit_monitor(cur["id"], **kw)
                print(f"CHANGED: sonde {m['name']} mise à jour ({', '.join(diff)})")
                changed += 1

        # --- Status page ---
        sp = cfg.status_page()
        if sp:
            if sp["slug"] not in {p["slug"] for p in api.get_status_pages()}:
                api.add_status_page(sp["slug"], sp["title"])
                print(f"CHANGED: status page {sp['slug']} créée")
                changed += 1
            groups = [{"name": g, "weight": i + 1,
                       "monitorList": [{"id": monitor_ids[m["name"]]} for m in cfg.monitors() if m.get("group") == g]}
                      for i, g in enumerate(sp.get("groups", []))]
            api.save_status_page(sp["slug"], title=sp["title"], description=sp.get("description", ""),
                                 domainNameList=sp["domains"], published=True, publicGroupList=groups)
    finally:
        api.disconnect()
    print(f"{changed} modification(s)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="URL d'Uptime Kuma (ex. http://HOTE:3001)")
    ap.add_argument("--contracts", default=str(REPO / "infra" / "contracts.yaml"))
    ap.add_argument("--monitors", default=str(HERE / "monitors.yml"))
    ap.add_argument("--dry-run", action="store_true", help="valide et affiche le plan sans se connecter")
    args = ap.parse_args()
    cfg = load(args)
    cfg.monitors(), cfg.notifications()  # validation structurelle
    if args.dry_run:
        return dry_run(cfg)
    if not args.url:
        ap.error("--url est requis hors --dry-run")
    return apply(cfg, args.url)


if __name__ == "__main__":
    sys.exit(main())
