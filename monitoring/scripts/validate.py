#!/usr/bin/env python3
"""Contrôles statiques de monitoring/ (appelé par monitoring/scripts/check.sh).

    validate.py dashboards     structure des dashboards Grafana + syntaxe PromQL (via promtool si disponible)
    validate.py rules          conventions des règles (sévérité, annotations, runbook_url)
    validate.py alertmanager   rend le template Ansible avec des secrets factices, amtool check-config et tests de routage
    validate.py secrets        aucun secret, IP publique ou hôte réel dans monitoring/ et le rôle monitoring-stack
    validate.py runbooks       liste triée des runbook_url référencés (pour la documentation)

Les binaires promtool et amtool sont cherchés dans $PROMTOOL / $AMTOOL puis dans le PATH ; absents, le contrôle
concerné est signalé « SKIP » (échec si PAD_REQUIRE_TOOLS=1).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
MON = ROOT / "monitoring"
ROLE = ROOT / "infra" / "ansible" / "roles" / "monitoring-stack"
DS_UIDS = {"victoriametrics", "loki", "tempo", "alertmanager", "-- Grafana --"}
SEVERITIES = {"critical", "warning", "info", "none"}
RUNBOOK_RE = re.compile(r"^docs/runbooks/[a-z0-9]+(-[a-z0-9]+)*\.md$")
errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)
    print(f"  ERREUR: {msg}")


def tool(name: str) -> str | None:
    path = os.environ.get(name.upper()) or shutil.which(name)
    if not path and os.environ.get("PAD_REQUIRE_TOOLS") == "1":
        fail(f"{name} introuvable (PAD_REQUIRE_TOOLS=1)")
    return path


# ------------------------------------------------------------------------------------------ dashboards
def walk(node, fn):
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            walk(v, fn)


def check_dashboards() -> None:
    files = sorted((MON / "dashboards").rglob("*.json"))
    if not files:
        fail("aucun dashboard dans monitoring/dashboards/")
    uids, exprs = {}, []
    for f in files:
        rel = f.relative_to(ROOT)
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            fail(f"{rel}: JSON invalide ({exc})")
            continue
        uid = d.get("uid", "")
        if not re.fullmatch(r"pad-[a-z0-9-]+", uid):
            fail(f"{rel}: uid « {uid} » invalide (attendu pad-<nom>)")
        if uid in uids:
            fail(f"{rel}: uid « {uid} » déjà utilisé par {uids[uid]}")
        uids[uid] = rel
        if d.get("id") is not None:
            fail(f"{rel}: « id » doit être absent ou null (attribué par Grafana)")
        for forbidden in ("gnetId", "__inputs", "__requires"):
            if forbidden in d:
                fail(f"{rel}: champ « {forbidden} » interdit (pas d'import grafana.com)")
        if "${DS_" in f.read_text(encoding="utf-8"):
            fail(f"{rel}: variable de datasource ${{DS_*}} interdite (uid de provisioning attendus)")
        ids = [p["id"] for p in d.get("panels", [])]
        if len(ids) != len(set(ids)):
            fail(f"{rel}: identifiants de panneaux dupliqués")

        def visit(n):
            ds = n.get("datasource")
            if isinstance(ds, dict) and ds.get("uid") not in DS_UIDS:
                fail(f"{rel}: datasource uid « {ds.get('uid')} » inconnu")
            if isinstance(ds, str):
                fail(f"{rel}: datasource par nom « {ds} » (utiliser {{type, uid}})")
            if "expr" in n and isinstance(n.get("datasource"), dict) and n["datasource"].get("uid") == "victoriametrics":
                exprs.append((rel, n["expr"]))

        walk(d, visit)
        print(f"  {rel}: uid={uid}, {len(d.get('panels', []))} éléments")

    promtool = tool("promtool")
    if not promtool:
        print("  SKIP: promtool absent, syntaxe PromQL des dashboards non vérifiée")
        return
    rules = {"groups": [{"name": "dashboards", "rules": [
        {"record": f"dash:q{i}", "expr": e} for i, (_, e) in enumerate(exprs)]}]}
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "dash.yml"
        p.write_text(yaml.safe_dump(rules, allow_unicode=True), encoding="utf-8")
        r = subprocess.run([promtool, "check", "rules", str(p)], capture_output=True, text=True)
    if r.returncode:
        fail(f"PromQL invalide dans les dashboards :\n{r.stdout}{r.stderr}")
    else:
        print(f"  PromQL: {len(exprs)} requêtes valides (promtool)")


# ------------------------------------------------------------------------------------------ rules
def load_rules() -> list[tuple[Path, dict]]:
    out = []
    for f in sorted((MON / "rules").glob("*.yml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        for g in doc.get("groups", []):
            for r in g.get("rules", []):
                out.append((f, {**r, "_group": g["name"]}))
    return out


def check_rules() -> None:
    names, n_alert, n_rec = {}, 0, 0
    for f, r in load_rules():
        rel = f.relative_to(ROOT)
        if "record" in r:
            n_rec += 1
            if not re.fullmatch(r"[a-z_]+(:[a-z0-9_]+)+", r["record"]):
                fail(f"{rel}: record « {r['record']} » ne suit pas niveau:métrique:opérations")
            continue
        n_alert += 1
        a = r["alert"]
        if a in names:
            fail(f"{rel}: alerte « {a} » dupliquée (aussi dans {names[a]})")
        names[a] = rel
        sev = r.get("labels", {}).get("severity")
        if sev not in SEVERITIES:
            fail(f"{rel}: {a}: severity « {sev} » invalide")
        ann = r.get("annotations", {})
        for k in ("summary", "description", "runbook_url"):
            if not ann.get(k):
                fail(f"{rel}: {a}: annotation « {k} » manquante")
        if ann.get("runbook_url") and not RUNBOOK_RE.match(ann["runbook_url"]):
            fail(f"{rel}: {a}: runbook_url « {ann['runbook_url']} » doit être docs/runbooks/<nom-kebab>.md")
        if sev == "critical" and "for" not in r:
            fail(f"{rel}: {a}: une alerte critical doit avoir un « for » (anti-flapping)")
    if "Watchdog" not in names:
        fail("alerte Watchdog absente")
    print(f"  {n_alert} alertes, {n_rec} recording rules conformes")


def list_runbooks() -> None:
    by_runbook: dict[str, list[str]] = {}
    for _, r in load_rules():
        if "alert" in r:
            by_runbook.setdefault(r["annotations"]["runbook_url"], []).append(r["alert"])
    for rb in sorted(by_runbook):
        print(f"{rb}\t{', '.join(sorted(by_runbook[rb]))}")


# ------------------------------------------------------------------------------------------ alertmanager
def render_alertmanager(tmp: Path, with_watchdog: bool, secrets_extra: dict | None = None) -> Path:
    import jinja2

    env = jinja2.Environment(loader=jinja2.FileSystemLoader(ROLE / "templates"), keep_trailing_newline=True,
                             undefined=jinja2.Undefined)
    env.filters["to_json"] = lambda v: json.dumps(v, ensure_ascii=False)
    secrets = {
        "smtp_smarthost": "smtp.example.invalid:587", "smtp_from": "alertmanager@example.invalid",
        "smtp_to": "ops@example.invalid", "smtp_username": "user", "smtp_password": "pass",
        "discord_webhook_url": "https://discord.example.invalid/api/webhooks/0/test",
    }
    if with_watchdog:
        secrets["uptime_kuma_watchdog_token"] = "A" * 32
    secrets.update(secrets_extra or {})
    ctx = {"monitoring_secrets": secrets, "monitoring_stack_runbook_base_url": "https://example.invalid/blob/main/"}
    cfg = tmp / "alertmanager.yml"
    cfg.write_text(env.get_template("alertmanager.yml.j2").render(**ctx), encoding="utf-8")
    (tmp / "templates").mkdir(exist_ok=True)
    (tmp / "templates" / "pad.tmpl").write_text(env.get_template("alertmanager-pad.tmpl.j2").render(**ctx),
                                               encoding="utf-8")
    # check-config résout le glob des templates relativement au système de fichiers : on le réécrit en local.
    cfg.write_text(cfg.read_text(encoding="utf-8").replace("/etc/alertmanager/templates", str(tmp / "templates")),
                   encoding="utf-8")
    return cfg


def check_alertmanager() -> None:
    amtool = tool("amtool")
    cases = yaml.safe_load((MON / "tests" / "alertmanager" / "routes.yml").read_text(encoding="utf-8"))
    for with_wd in (True, False):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            cfg = render_alertmanager(tmp, with_wd)
            yaml.safe_load(cfg.read_text(encoding="utf-8"))  # YAML valide
            if not amtool:
                print("  SKIP: amtool absent, config Alertmanager rendue mais non vérifiée")
                continue
            r = subprocess.run([amtool, "check-config", str(cfg)], capture_output=True, text=True)
            if r.returncode:
                fail(f"amtool check-config (watchdog={with_wd}) :\n{r.stdout}{r.stderr}")
                continue
            for c in cases:
                labels = [f"{k}={v}" for k, v in c["labels"].items()]
                r = subprocess.run([amtool, "config", "routes", "test", f"--config.file={cfg}",
                                    f"--verify.receivers={','.join(c['receivers'])}", *labels],
                                   capture_output=True, text=True)
                if r.returncode:
                    fail(f"routage {c['labels']} -> attendu {c['receivers']}, obtenu « {r.stdout.strip()} »")
            # Rendu de notification : le template de message doit compiler et contenir le runbook.
            if with_wd:
                tpl = subprocess.run([amtool, "template", "render", f"--template.glob={tmp / 'templates' / 'pad.tmpl'}",
                                      "--template.text={{ template \"pad.discord.message\" . }}"],
                                     capture_output=True, text=True)
                if tpl.returncode:
                    fail(f"rendu du template Discord :\n{tpl.stdout}{tpl.stderr}")
            print(f"  watchdog={'oui' if with_wd else 'non'}: check-config OK, {len(cases)} routes vérifiées")


# ------------------------------------------------------------------------------------------ secrets
PRIVATE_IP = re.compile(r"^(10\.|127\.|0\.0\.0\.0|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)")
IPV4 = re.compile(r"(?<![\d.])(\d{1,3}\.){3}\d{1,3}(?![\d.])")
SECRET_PATTERNS = [
    (re.compile(r"discord(app)?\.com/api/webhooks/\d{6,}/[\w-]{20,}"), "webhook Discord réel"),
    (re.compile(r"hooks\.slack\.com/services/\w+/\w+/\w+"), "webhook Slack"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "clé privée"),
    (re.compile(r"(?i)(smtp_)?password\s*[:=]\s*['\"]?(?!CHANGEME|\{\{|\$|pass['\"]?$)[^\s'\"{}$]{6,}"), "mot de passe en clair"),
]


def check_secrets() -> None:
    n = 0
    targets = [p for base in (MON, ROLE) for p in base.rglob("*") if p.is_file() and "__pycache__" not in p.parts]
    for f in targets:
        if f.suffix in {".pyc"}:
            continue
        txt = f.read_text(encoding="utf-8", errors="replace")
        rel = f.relative_to(ROOT)
        n += 1
        for rx, label in SECRET_PATTERNS:
            if f.suffix in {".py", ".sh"} and label == "mot de passe en clair":
                continue  # code : lecture d'identifiants par variables d'environnement
            if f.name == "validate.py":
                break
            if rx.search(txt):
                fail(f"{rel}: {label} détecté")
        if f.suffix == ".json" and f.parent.name == "dashboards" or f.suffix in {".yml", ".yaml", ".j2", ".py", ".sh"}:
            for m in IPV4.finditer(txt):
                ip = m.group(0)
                if not PRIVATE_IP.match(ip) and all(0 <= int(o) <= 255 for o in ip.split(".")):
                    # numéros de version tolérés quand ils sont précédés de v, = ou @
                    ctx = txt[max(0, m.start() - 2):m.start()]
                    if not re.search(r"[v=@]$", ctx.strip() or " ") and f.name != "requirements.txt":
                        fail(f"{rel}: adresse IP publique « {ip} »")
    print(f"  {n} fichiers analysés")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    table = {"dashboards": check_dashboards, "rules": check_rules, "alertmanager": check_alertmanager,
             "secrets": check_secrets, "runbooks": list_runbooks}
    if cmd not in table:
        print(__doc__)
        return 2
    table[cmd]()
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
