"""metrics_exporter : endpoint Prometheus `/metrics` protégé par un token.

Auth : `Authorization: Bearer <PAD_METRICS_TOKEN>` (sans token configuré,
l'endpoint répond 503 : fail closed).

Les valeurs sont calculées depuis la base (identiques sur tous les pods) et
mises en cache PAD_METRICS_CACHE_SECONDS (15 s par défaut) dans le cache
partagé (Valkey). Côté PromQL, agréger avec `max without (pod, instance)`.

Activité : un hook after_request mémorise la dernière activité de chaque
utilisateur authentifié (table `pad_activity`, écriture limitée à une par
minute et par utilisateur). `ctfd_active_users{window="5m"}` alimente le
ScaledObject KEDA (les appels du BFF sont authentifiés par token, que le
`Tracking` natif de CTFd ne voit pas).
"""

import datetime
import hmac
import time

from flask import Response, abort, request, session
from sqlalchemy import func

from CTFd.cache import cache
from CTFd.models import Challenges, Solves, Submissions, Teams, Users, db
from CTFd.plugins.pad_common.settings import setting, setting_int
from CTFd.utils import get_config
from CTFd.utils.modes import TEAMS_MODE

CACHE_KEY = "pad:metrics:payload"
ACTIVE_WINDOWS = {"1m": 60, "5m": 300, "15m": 900}


class Activity(db.Model):
    __tablename__ = "pad_activity"
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_seen = db.Column(db.DateTime, index=True)


def _escape(value):
    return (
        str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
    )


class Registry:
    def __init__(self):
        self._lines = []
        self._declared = set()

    def add(self, name, mtype, help_text, value, labels=None):
        if name not in self._declared:
            self._lines.append(f"# HELP {name} {help_text}")
            self._lines.append(f"# TYPE {name} {mtype}")
            self._declared.add(name)
        if labels:
            rendered = ",".join(
                f'{k}="{_escape(v)}"' for k, v in sorted(labels.items())
            )
            self._lines.append(f"{name}{{{rendered}}} {value}")
        else:
            self._lines.append(f"{name} {value}")

    def render(self):
        return "\n".join(self._lines) + "\n"


def _event_state(now):
    start = int(get_config("start") or 0)
    end = int(get_config("end") or 0)
    freeze = int(get_config("freeze") or 0)
    paused = bool(get_config("paused"))
    if start and now < start:
        state = "not_started"
    elif end and now > end:
        state = "ended"
    elif paused:
        state = "paused"
    elif freeze and now > freeze:
        state = "frozen"
    else:
        state = "running"
    return state, start, end, freeze


def _visible_accounts_filter(query, model_user=Users):
    return query.filter(model_user.banned.is_(False), model_user.hidden.is_(False))


def collect():
    reg = Registry()
    now = time.time()
    teams_mode = get_config("user_mode") == TEAMS_MODE

    # --- Comptes ---
    reg.add("ctfd_users", "gauge", "Nombre d'utilisateurs par catégorie",
            Users.query.count(), {"kind": "all"})
    reg.add("ctfd_users", "gauge", "Nombre d'utilisateurs par catégorie",
            Users.query.filter_by(banned=True).count(), {"kind": "banned"})
    reg.add("ctfd_users", "gauge", "Nombre d'utilisateurs par catégorie",
            Users.query.filter_by(hidden=True).count(), {"kind": "hidden"})
    reg.add("ctfd_users", "gauge", "Nombre d'utilisateurs par catégorie",
            Users.query.filter_by(type="admin").count(), {"kind": "admin"})
    reg.add("ctfd_teams", "gauge", "Nombre d'équipes par catégorie",
            Teams.query.count(), {"kind": "all"})
    reg.add("ctfd_teams", "gauge", "Nombre d'équipes par catégorie",
            Teams.query.filter_by(banned=True).count(), {"kind": "banned"})

    # --- Activité ---
    for window, seconds in ACTIVE_WINDOWS.items():
        since = datetime.datetime.utcnow() - datetime.timedelta(seconds=seconds)
        count = Activity.query.filter(Activity.last_seen >= since).count()
        reg.add("ctfd_active_users", "gauge",
                "Utilisateurs ayant fait une requête authentifiée dans la fenêtre",
                count, {"window": window})

    # --- Challenges ---
    challenges = Challenges.query.all()
    by_id = {c.id: c for c in challenges}
    groups = {}
    for c in challenges:
        key = (c.state, c.type, c.category or "")
        groups[key] = groups.get(key, 0) + 1
    for (state, ctype, category), count in sorted(groups.items()):
        reg.add("ctfd_challenges", "gauge", "Nombre de challenges", count,
                {"state": state, "type": ctype, "category": category})

    # Solves comptés hors comptes bannis/cachés (comme le scoreboard).
    solves_q = db.session.query(Solves.challenge_id, func.count(Solves.id)).join(
        Users, Solves.user_id == Users.id
    )
    solves_q = _visible_accounts_filter(solves_q)
    if teams_mode:
        solves_q = solves_q.join(Teams, Solves.team_id == Teams.id).filter(
            Teams.banned.is_(False), Teams.hidden.is_(False)
        )
    solves = dict(solves_q.group_by(Solves.challenge_id).all())
    for cid, c in sorted(by_id.items()):
        labels = {"challenge_id": cid, "challenge": c.name,
                  "category": c.category or ""}
        reg.add("ctfd_challenge_solves", "gauge",
                "Solves par challenge (comptes visibles)", solves.get(cid, 0), labels)
        reg.add("ctfd_challenge_value", "gauge", "Valeur courante du challenge",
                c.value or 0, labels)

    # --- Soumissions ---
    sub_rows = (
        db.session.query(Submissions.challenge_id, Submissions.type,
                         func.count(Submissions.id))
        .filter(Submissions.type.in_(("correct", "incorrect")))
        .group_by(Submissions.challenge_id, Submissions.type)
        .all()
    )
    totals = {"correct": 0, "incorrect": 0}
    for cid, stype, count in sub_rows:
        totals[stype] += count
        c = by_id.get(cid)
        reg.add("ctfd_challenge_submissions_total", "counter",
                "Soumissions par challenge et résultat", count,
                {"challenge_id": cid, "challenge": c.name if c else "",
                 "result": stype})
    for result, count in totals.items():
        reg.add("ctfd_submissions_total", "counter",
                "Soumissions de flags par résultat", count, {"result": result})

    # --- First bloods ---
    fb_q = db.session.query(
        Solves.challenge_id, func.min(Solves.date)
    ).join(Users, Solves.user_id == Users.id)
    fb_q = _visible_accounts_filter(fb_q).group_by(Solves.challenge_id)
    for cid, first_date in fb_q.all():
        solve = Solves.query.filter_by(challenge_id=cid, date=first_date).first()
        c = by_id.get(cid)
        if solve is None or c is None:
            continue
        account = solve.team.name if (teams_mode and solve.team) else solve.user.name
        reg.add("ctfd_challenge_first_blood_timestamp_seconds", "gauge",
                "Date du premier solve (first blood)",
                int(first_date.replace(tzinfo=datetime.timezone.utc).timestamp()),
                {"challenge_id": cid, "challenge": c.name,
                 "category": c.category or "", "account": account})
    reg.add("ctfd_first_bloods", "gauge", "Challenges ayant un first blood",
            len(solves), None)

    # --- Événement ---
    state, start, end, freeze = _event_state(now)
    for s in ("not_started", "running", "paused", "frozen", "ended"):
        reg.add("ctfd_event_state", "gauge", "État courant de l'événement (1 = actif)",
                1 if s == state else 0, {"state": s})
    reg.add("ctfd_event_start_timestamp_seconds", "gauge", "Début de l'événement",
            start)
    reg.add("ctfd_event_end_timestamp_seconds", "gauge", "Fin de l'événement", end)
    reg.add("ctfd_event_freeze_timestamp_seconds", "gauge",
            "Gel du scoreboard", freeze)

    # --- Instances (plugin chall_manager_bridge) ---
    try:
        from CTFd.plugins.chall_manager_bridge.models import InstanceRecord

        active = InstanceRecord.query.filter(
            InstanceRecord.until.is_(None)
            | (InstanceRecord.until > datetime.datetime.utcnow())
        ).count()
        reg.add("pad_instances_active", "gauge",
                "Instances de challenges actives (selon CTFd)", active)
    except ImportError:
        pass

    reg.add("ctfd_metrics_generated_timestamp_seconds", "gauge",
            "Date de calcul des métriques", int(now))
    return reg.render()


def metrics_view():
    expected = setting("PAD_METRICS_TOKEN")
    if not expected:
        abort(503, description="Metrics token not configured")
    header = request.headers.get("Authorization", "")
    scheme, _, provided = header.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(
        provided.strip().encode(), expected.encode()
    ):
        abort(401)
    payload = cache.get(CACHE_KEY)
    if payload is None:
        payload = collect()
        cache.set(CACHE_KEY, payload,
                  timeout=setting_int("PAD_METRICS_CACHE_SECONDS", 15))
    return Response(payload, mimetype="text/plain; version=0.0.4; charset=utf-8")


def record_activity(response):
    user_id = session.get("id")
    if not user_id or response.status_code >= 500:
        return response
    key = f"pad:activity:{user_id}"
    if cache.get(key):
        return response
    try:
        now = datetime.datetime.utcnow()
        row = Activity.query.filter_by(user_id=user_id).first()
        if row is None:
            db.session.add(Activity(user_id=user_id, last_seen=now))
        else:
            row.last_seen = now
        db.session.commit()
        cache.set(key, 1, timeout=60)
    except Exception:  # noqa: BLE001 - la métrique ne doit jamais casser une requête
        db.session.rollback()
    return response


def load(app):
    with app.app_context():
        db.create_all()
    app.add_url_rule("/metrics", endpoint="pad_metrics", view_func=metrics_view)
    app.after_request(record_activity)
