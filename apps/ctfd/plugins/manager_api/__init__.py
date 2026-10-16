"""manager_api : API headless du portail manager (import de challenges, stats, événement).

Endpoints (rôle manager ou admin, via token API CTFd ou session) :

    POST  /api/v1/manager/challenges/import     multipart `file` = ZIP (challenge.yml + fichiers)
    GET   /api/v1/manager/challenges            liste + stats résumées
    GET   /api/v1/manager/challenges/<id>/stats stats détaillées d'un challenge
    GET   /api/v1/manager/event                 état de l'événement
    PATCH /api/v1/manager/event                 start / end / freeze / paused
    GET   /api/v1/manager/users                 comptes joueurs (recherche, filtres, pagination)
    PATCH /api/v1/manager/users/<id>            bannir / masquer
    GET   /api/v1/manager/teams                 équipes (idem)
    PATCH /api/v1/manager/teams/<id>            bannir / masquer
    GET   /api/v1/manager/submissions           soumissions (filtres, pagination)
    DELETE /api/v1/manager/submissions/<id>     invalide une soumission (solve annulé)
    GET   /api/v1/manager/awards                awards
    DELETE /api/v1/manager/awards/<id>          invalide un award

Chaque action de modération est journalisée (logger `pad.audit`, JSON).

Voir apps/ctfd/API.md pour le contrat complet. Les requêtes authentifiées par
header `Authorization` sont exemptées de CSRF par CTFd ; les appels par cookie
de session restent soumis au jeton CSRF (pas de `bypass_csrf_protection`).
"""

import datetime
import hashlib
import io
import posixpath

import yaml
from flask import Blueprint, jsonify, request
from jsonschema import Draft202012Validator
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import HTTPException

from CTFd.cache import (
    cache,
    clear_challenges,
    clear_config,
    clear_standings,
    clear_team_session,
    clear_user_session,
)
from CTFd.models import (
    ChallengeFiles,
    Challenges,
    Flags,
    Awards,
    Hints,
    Submissions,
    Tags,
    Teams,
    UserTokens,
    Users,
    db,
)
from CTFd.plugins.challenges.decay import DECAY_FUNCTIONS
from CTFd.plugins.pad_common import chall_manager as cm
from CTFd.plugins.pad_common.audit import audit
from CTFd.plugins.pad_common.event import event_json
from CTFd.plugins.pad_common.scores import first_blood_json, iso, visible_solves
from CTFd.plugins.pad_common.roles import (
    ROLE_ADMIN,
    get_roles,
    is_manager,
    manager_required,
)
from CTFd.plugins.pad_common.settings import setting_int
from CTFd.utils import get_config, set_config
from CTFd.utils.modes import TEAMS_MODE
from CTFd.utils.user import get_current_user
from CTFd.utils.uploads import delete_file, upload_file

from .archive import ArchiveError, read_archive, safe_path
from .schema import load_schema

bp = Blueprint("pad_manager_api", __name__)

DEFAULT_TTL = 3600  # défaut du schéma (instance.ttl)
INSTANCE_TYPE = "dynamic_instance"


# --------------------------------------------------------------------------
# Réponses
# --------------------------------------------------------------------------


def _error(status, message, errors=None):
    body = {"success": False, "errors": errors or {"_": [message]}}
    resp = jsonify(body)
    resp.status_code = status
    return resp


def _http_error(exc):
    return _error(exc.code or 500, exc.description or exc.name)


# CTFd enregistre des handlers HTML par code (401, 403, 404, 500, 502) au niveau
# application ; Flask teste d'abord le code puis la classe, donc un handler
# `HTTPException` de blueprint ne suffit pas : on enregistre chaque code.
for _code in (400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502, 503):
    bp.register_error_handler(_code, _http_error)
bp.register_error_handler(HTTPException, _http_error)


class ImportError_(Exception):
    def __init__(self, status, message, errors=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.errors = errors


@bp.errorhandler(ImportError_)
def _import_error(exc):
    return _error(exc.status, exc.message, exc.errors)


@bp.errorhandler(ArchiveError)
def _archive_error(exc):
    return _error(exc.status, exc.message)


_iso = iso


# --------------------------------------------------------------------------
# Import de challenge
# --------------------------------------------------------------------------


def _parse_spec(yaml_bytes):
    try:
        spec = yaml.safe_load(yaml_bytes.decode("utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise ImportError_(422, f"Invalid challenge.yml: {exc}")
    if not isinstance(spec, dict):
        raise ImportError_(422, "challenge.yml must be a mapping")
    validator = Draft202012Validator(load_schema())
    problems = sorted(
        validator.iter_errors(spec), key=lambda e: [str(p) for p in e.absolute_path]
    )
    if problems:
        lines = [
            f"{'.'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message}"
            for e in problems
        ]
        raise ImportError_(
            422, "challenge.yml does not match the schema", {"challenge.yml": lines}
        )
    return spec


def _resolve_type(spec):
    """`instance` => `dynamic_instance` ; sinon `standard` (`dynamic` = standard
    + fonction de décroissance, voir `_scoring`)."""
    return INSTANCE_TYPE if "instance" in spec else "standard"


def _scoring(spec):
    """Champs de valeur : (value, function, initial, minimum, decay)."""
    extra = spec.get("extra") or {}
    if spec.get("type") == "dynamic":
        function = extra.get("function") or "logarithmic"
        missing = [k for k in ("initial", "minimum", "decay") if k not in extra]
        if missing:
            raise ImportError_(
                422, f"Dynamic scoring requires extra.{', extra.'.join(missing)}"
            )
        if extra["minimum"] > extra["initial"]:
            raise ImportError_(422, "extra.minimum must be <= extra.initial")
        return (
            extra["initial"], function, extra["initial"], extra["minimum"],
            extra["decay"],
        )
    if "value" not in spec:
        raise ImportError_(422, "'value' is required for static scoring")
    return spec["value"], "static", None, None, None


def _port(p):
    """Port du schéma : entier ou {port, protocol?, name?} -> "port/proto"."""
    if isinstance(p, dict):
        return f"{p['port']}/{p.get('protocol', 'tcp')}"
    return f"{p}/tcp"


_TTL_UNITS = {"s": 1, "m": 60, "h": 3600}


def _ttl(value):
    """Secondes ou durée `90s` / `30m` / `2h`, bornée à 60..21600 s."""
    if isinstance(value, str):
        text = value.strip()
        seconds = int(text[:-1].strip()) * _TTL_UNITS[text[-1]]
    else:
        seconds = value
    if not (60 <= seconds <= 21600):
        raise ImportError_(422, "instance.ttl must be between 60s and 6h")
    return seconds


def _instance_fields(inst):
    config = {
        "image": inst["image"],
        "ports": ",".join(_port(p) for p in inst["ports"]),
    }
    limits = inst.get("limits") or {}
    if "cpu" in limits:
        config["limits_cpu"] = limits["cpu"]
    if "memory" in limits:
        config["limits_memory"] = limits["memory"]
    # scenario / renouvellements / flag par instance ne font pas partie du
    # schéma : valeurs par défaut du modèle, réglables via l'API admin CTFd.
    return {
        "instance_config": config,
        "timeout": _ttl(inst["ttl"]) if "ttl" in inst else DEFAULT_TTL,
    }


def _requirements(spec, challenge):
    names = spec.get("requirements")
    if not names:
        return None
    ids = []
    for name in names:
        if name == spec["name"]:
            raise ImportError_(422, "A challenge cannot require itself")
        if isinstance(name, (int, float)):
            found = Challenges.query.filter_by(id=int(name)).first()
        else:
            found = Challenges.query.filter_by(name=name).first()
        if found is None:
            raise ImportError_(422, f"Unknown requirement: {name}")
        ids.append(found.id)
    return {"prerequisites": ids}


def _basename(path):
    return posixpath.basename(path)


def _replace_children(challenge, spec):
    Flags.query.filter_by(challenge_id=challenge.id).delete()
    Hints.query.filter_by(challenge_id=challenge.id).delete()
    Tags.query.filter_by(challenge_id=challenge.id).delete()
    for flag in spec.get("flags", []):
        if isinstance(flag, str):
            flag = {"content": flag}
        db.session.add(
            Flags(
                challenge_id=challenge.id,
                type=flag.get("type", "static"),
                content=flag["content"],
                data="" if flag.get("data") == "case_sensitive" else flag.get("data", ""),
            )
        )
    for hint in spec.get("hints", []):
        if isinstance(hint, str):
            hint = {"content": hint}
        db.session.add(
            Hints(
                challenge_id=challenge.id,
                content=hint["content"],
                cost=hint.get("cost", 0),
            )
        )
    for tag in dict.fromkeys(spec.get("tags", [])):
        db.session.add(Tags(challenge_id=challenge.id, value=tag))


def _wanted_files(spec, archive_files):
    """{nom: octets} des fichiers listés ; 422 si absent ou chemin douteux."""
    wanted = {}
    for rel in spec.get("files", []):
        try:
            rel = safe_path(rel)
        except ArchiveError as exc:
            raise ImportError_(exc.status, exc.message)
        if rel not in archive_files:
            raise ImportError_(422, f"Listed file missing from archive: {rel}")
        base = _basename(rel)
        if base in wanted:
            raise ImportError_(422, f"Two files share the name {base!r}")
        wanted[base] = archive_files[rel]
    return wanted


def _sync_files(challenge, wanted):
    """Téléverse les fichiers via le provider CTFd ; idempotent (sha1)."""
    existing = ChallengeFiles.query.filter_by(challenge_id=challenge.id).all()
    kept = set()
    for row in existing:
        base = _basename(row.location)
        data = wanted.get(base)
        if data is not None and row.sha1sum == hashlib.sha1(data).hexdigest():  # nosec
            kept.add(base)
        else:
            delete_file(row.id)
    uploaded = []
    for base, data in wanted.items():
        if base in kept:
            continue
        stream = io.BytesIO(data)
        upload_file(
            file=FileStorage(stream=stream, filename=base),
            challenge_id=challenge.id,
            type="challenge",
        )
        uploaded.append(base)
    return sorted(wanted), uploaded


def import_challenge(spec, archive_files):
    """Crée ou met à jour (clé = nom) le challenge décrit par `spec`."""
    ctype = _resolve_type(spec)
    value, function, initial, minimum, decay = _scoring(spec)
    wanted = _wanted_files(spec, archive_files)

    matches = Challenges.query.filter_by(name=spec["name"]).all()
    if len(matches) > 1:
        raise ImportError_(409, f"Several challenges are named {spec['name']!r}")
    challenge = matches[0] if matches else None
    created = challenge is None
    if challenge is not None and challenge.type != ctype:
        raise ImportError_(
            409,
            f"Challenge type cannot change ({challenge.type} -> {ctype}); "
            "delete the challenge first",
        )

    fields = {
        "description": spec["description"],
        "category": spec["category"],
        "attribution": spec.get("attribution") or spec.get("author"),
        "connection_info": spec.get("connection_info"),
        "max_attempts": spec.get("attempts", 0),
        "state": spec.get("state", "hidden"),
        "value": value,
        "function": function,
        "initial": initial,
        "minimum": minimum,
        "decay": decay,
    }
    if ctype == INSTANCE_TYPE:
        fields.update(_instance_fields(spec["instance"]))

    try:
        if created:
            if ctype == INSTANCE_TYPE:
                from CTFd.plugins.chall_manager_bridge.models import (
                    DynamicInstanceChallenge as Model,
                )
            else:
                Model = Challenges
            challenge = Model(name=spec["name"], type=ctype, **fields)
            db.session.add(challenge)
        else:
            config = fields.pop("instance_config", None)
            for attr, val in fields.items():
                setattr(challenge, attr, val)
            if config is not None:
                challenge.set_config(config)
        db.session.flush()
        challenge.requirements = _requirements(spec, challenge)
        if function in DECAY_FUNCTIONS:
            challenge.value = DECAY_FUNCTIONS[function](challenge)
        _replace_children(challenge, spec)

        if ctype == INSTANCE_TYPE:
            from CTFd.plugins.chall_manager_bridge import sync_challenge

            try:
                sync_challenge(challenge)
            except cm.ChallManagerError as exc:
                db.session.rollback()
                status = 422 if exc.status in (400, 404, 409) else 502
                raise ImportError_(status, f"chall-manager: {exc.message}")
        db.session.commit()
    except ImportError_:
        db.session.rollback()
        raise
    except Exception:
        db.session.rollback()
        raise

    files, uploaded = _sync_files(challenge, wanted)
    clear_challenges()
    return {
        "id": challenge.id,
        "name": challenge.name,
        "action": "created" if created else "updated",
        "type": challenge.type,
        "state": challenge.state,
        "value": challenge.value,
        "instance": ctype == INSTANCE_TYPE,
        "flags": len(spec.get("flags", [])),
        "hints": len(spec.get("hints", [])),
        "tags": len(set(spec.get("tags", []))),
        "files": files,
        "files_uploaded": uploaded,
    }, created


@bp.route("/api/v1/manager/challenges/import", methods=["POST"])
@manager_required
def import_view():
    limit = setting_int("PAD_IMPORT_MAX_ZIP_BYTES", 50 * 1024 * 1024)
    if request.content_length and request.content_length > limit + 64 * 1024:
        return _error(413, "Archive too large")
    upload = request.files.get("file")
    if upload is None:
        return _error(400, "Multipart field 'file' (ZIP) is required")
    raw = upload.stream.read(limit + 1)
    if len(raw) > limit:
        return _error(413, "Archive too large")
    yaml_bytes, files = read_archive(raw)
    spec = _parse_spec(yaml_bytes)
    data, created = import_challenge(spec, files)
    return jsonify({"success": True, "data": data}), (201 if created else 200)


# --------------------------------------------------------------------------
# Stats
# --------------------------------------------------------------------------


def _visible(query):
    """Exclut comptes bannis/cachés (managers inclus) comme le scoreboard."""
    query = query.join(Users, Submissions.user_id == Users.id).filter(
        Users.banned.is_(False), Users.hidden.is_(False)
    )
    if get_config("user_mode") == TEAMS_MODE:
        query = query.join(Teams, Submissions.team_id == Teams.id).filter(
            Teams.banned.is_(False), Teams.hidden.is_(False)
        )
    return query


def _rate(solves, attempts):
    return round(solves / attempts, 4) if attempts else 0.0


def _counts():
    """({challenge_id: solves}, {challenge_id: attempts}) sur comptes visibles."""
    from sqlalchemy import func

    rows = (
        _visible(
            db.session.query(
                Submissions.challenge_id, Submissions.type, func.count(Submissions.id)
            )
        )
        .filter(Submissions.type.in_(("correct", "incorrect")))
        .group_by(Submissions.challenge_id, Submissions.type)
        .all()
    )
    solves, attempts = {}, {}
    for cid, stype, n in rows:
        attempts[cid] = attempts.get(cid, 0) + n
        if stype == "correct":
            solves[cid] = n
    return solves, attempts


def _summary(c, solves, attempts):
    return {
        "id": c.id,
        "name": c.name,
        "category": c.category,
        "type": c.type,
        "state": c.state,
        "value": c.value,
        "function": c.function,
        "instance": c.type == INSTANCE_TYPE,
        "tags": sorted(t.value for t in c.tags),
        "solves": solves,
        "attempts": attempts,
        "success_rate": _rate(solves, attempts),
    }


@bp.route("/api/v1/manager/challenges", methods=["GET"])
@manager_required
def list_challenges():
    solves, attempts = _counts()
    items = [
        _summary(c, solves.get(c.id, 0), attempts.get(c.id, 0))
        for c in Challenges.query.order_by(Challenges.category, Challenges.name).all()
    ]
    total_s = sum(i["solves"] for i in items)
    total_a = sum(i["attempts"] for i in items)
    return jsonify(
        {
            "success": True,
            "data": items,
            "meta": {
                "count": len(items),
                "solves": total_s,
                "attempts": total_a,
                "success_rate": _rate(total_s, total_a),
            },
        }
    )


def _bucket(dt, size):
    if size == "day":
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt.replace(minute=0, second=0, microsecond=0)


@bp.route("/api/v1/manager/challenges/<int:challenge_id>/stats", methods=["GET"])
@manager_required
def challenge_stats(challenge_id):
    challenge = Challenges.query.filter_by(id=challenge_id).first()
    if challenge is None:
        return _error(404, "No challenge with this id")
    bucket = request.args.get("bucket", "hour")
    if bucket not in ("hour", "day"):
        return _error(400, "bucket must be 'hour' or 'day'")

    solves_map, attempts_map = _counts()
    solves = solves_map.get(challenge_id, 0)
    attempts = attempts_map.get(challenge_id, 0)

    rows = visible_solves(challenge_id).all()
    first = first_blood_json(rows[0]) if rows else None
    series, cumulative = {}, 0
    for s in rows:
        key = _bucket(s.date, bucket)
        series[key] = series.get(key, 0) + 1
    points = []
    for key in sorted(series):
        cumulative += series[key]
        points.append({"t": _iso(key), "solves": series[key], "cumulative": cumulative})

    data = _summary(challenge, solves, attempts)
    data.update(
        {
            "incorrect_attempts": attempts - solves,
            "first_blood": first,
            "bucket": bucket,
            "solves_over_time": points,
        }
    )
    return jsonify({"success": True, "data": data})


# --------------------------------------------------------------------------
# Événement
# --------------------------------------------------------------------------

EVENT_KEYS = ("start", "end", "freeze")


def _to_epoch(key, value):
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{key} must be an epoch or an ISO 8601 date")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return int(text)
        try:
            dt = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"{key} must be an epoch or an ISO 8601 date")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return int(dt.timestamp())
    raise ValueError(f"{key} must be an epoch or an ISO 8601 date")


@bp.route("/api/v1/manager/event", methods=["GET"])
@manager_required
def get_event():
    return jsonify({"success": True, "data": event_json()})


@bp.route("/api/v1/manager/event", methods=["PATCH"])
@manager_required
def patch_event():
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not body:
        return _error(400, "JSON object expected")
    unknown = set(body) - set(EVENT_KEYS) - {"paused"}
    if unknown:
        return _error(400, f"Unknown field(s): {', '.join(sorted(unknown))}")

    current = event_json()
    merged = {k: current[k] for k in EVENT_KEYS}
    try:
        for key in EVENT_KEYS:
            if key in body:
                value = _to_epoch(key, body[key])
                if value is not None and value < 0:
                    raise ValueError(f"{key} must be positive")
                merged[key] = value
    except ValueError as exc:
        return _error(400, str(exc))
    paused = body.get("paused", current["paused"])
    if not isinstance(paused, bool):
        return _error(400, "paused must be a boolean")

    start, end, freeze = merged["start"], merged["end"], merged["freeze"]
    if start and end and start >= end:
        return _error(422, "start must be before end")
    if freeze and start and freeze < start:
        return _error(422, "freeze must not be before start")
    if freeze and end and freeze > end:
        return _error(422, "freeze must not be after end")

    for key in EVENT_KEYS:
        if key in body:
            set_config(key, merged[key])
    if "paused" in body:
        set_config("paused", paused)
    clear_config()
    clear_standings()
    return jsonify({"success": True, "data": event_json()})


# --------------------------------------------------------------------------
# Modération : comptes, équipes, soumissions, awards
# --------------------------------------------------------------------------

MAX_PER_PAGE = 200
MODERATION_FIELDS = ("banned", "hidden")


def _paging():
    """(page, per_page) depuis la query string ; ValueError si invalide."""
    try:
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
    except ValueError:
        raise ValueError("page and per_page must be integers")
    if page < 1 or not (1 <= per_page <= MAX_PER_PAGE):
        raise ValueError(f"page must be >= 1 and per_page within 1..{MAX_PER_PAGE}")
    return page, per_page


def _flag(name):
    """Filtre booléen optionnel `?name=true|false` ; None si absent."""
    raw = request.args.get(name)
    if raw is None or raw == "":
        return None
    if raw.lower() in ("1", "true"):
        return True
    if raw.lower() in ("0", "false"):
        return False
    raise ValueError(f"{name} must be true or false")


def _page_response(query, page, per_page, serialize):
    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify(
        {
            "success": True,
            "data": [serialize(r) for r in rows],
            "meta": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "count": len(rows),
            },
        }
    )


def _like(column, text):
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


def _user_json(u):
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "type": u.type,
        "roles": get_roles(u),
        "team_id": u.team_id,
        "team_name": u.team.name if u.team else None,
        "banned": bool(u.banned),
        "hidden": bool(u.hidden),
        "created": _iso(u.created),
    }


def _team_json(t):
    return {
        "id": t.id,
        "name": t.name,
        "captain_id": t.captain_id,
        "member_count": len(t.members),
        "banned": bool(t.banned),
        "hidden": bool(t.hidden),
        "created": _iso(t.created),
    }


@bp.route("/api/v1/manager/users", methods=["GET"])
@manager_required
def list_users():
    try:
        page, per_page = _paging()
        banned, hidden = _flag("banned"), _flag("hidden")
    except ValueError as exc:
        return _error(400, str(exc))
    query = Users.query
    q = (request.args.get("q") or "").strip()
    if q:
        query = query.filter(_like(Users.name, q) | _like(Users.email, q))
    if banned is not None:
        query = query.filter(Users.banned.is_(banned))
    if hidden is not None:
        query = query.filter(Users.hidden.is_(hidden))
    return _page_response(query.order_by(Users.name, Users.id), page, per_page, _user_json)


@bp.route("/api/v1/manager/teams", methods=["GET"])
@manager_required
def list_teams():
    try:
        page, per_page = _paging()
        banned, hidden = _flag("banned"), _flag("hidden")
    except ValueError as exc:
        return _error(400, str(exc))
    query = Teams.query
    q = (request.args.get("q") or "").strip()
    if q:
        query = query.filter(_like(Teams.name, q))
    if banned is not None:
        query = query.filter(Teams.banned.is_(banned))
    if hidden is not None:
        query = query.filter(Teams.hidden.is_(hidden))
    return _page_response(query.order_by(Teams.name, Teams.id), page, per_page, _team_json)


def _moderation_changes():
    """({champ: bool}, None) ou (None, réponse d'erreur) depuis le corps JSON."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not body:
        return None, _error(400, "JSON object expected")
    unknown = set(body) - set(MODERATION_FIELDS)
    if unknown:
        return None, _error(400, f"Unknown field(s): {', '.join(sorted(unknown))}")
    for key, value in body.items():
        if not isinstance(value, bool):
            return None, _error(400, f"{key} must be a boolean")
    return dict(body), None


def _can_moderate(actor, target):
    """Pas d'auto-modération ; seuls les admins touchent managers et admins."""
    if target.id == actor.id:
        return "You cannot moderate yourself"
    if is_manager(target) and ROLE_ADMIN not in get_roles(actor):
        return "Only an admin can moderate a manager or an admin"
    return None


def _apply(entity, changes):
    """Applique les changements ; retourne ceux qui modifient réellement."""
    applied = {}
    for key, value in changes.items():
        if bool(getattr(entity, key)) != value:
            setattr(entity, key, value)
            applied[key] = value
    return applied


@bp.route("/api/v1/manager/users/<int:user_id>", methods=["PATCH"])
@manager_required
def moderate_user(user_id):
    user = Users.query.filter_by(id=user_id).first()
    if user is None:
        return _error(404, "No user with this id")
    changes, error = _moderation_changes()
    if error is not None:
        return error
    actor = get_current_user()
    refusal = _can_moderate(actor, user)
    if refusal:
        audit("user.moderate.denied", actor, "user", user.id, user.name,
              requested=changes, reason=refusal)
        return _error(403, refusal)
    applied = _apply(user, changes)
    if applied.get("banned"):
        # Un joueur banni perd ses tokens API (le prochain échange SSO est refusé).
        UserTokens.query.filter_by(user_id=user.id).delete(synchronize_session=False)
    db.session.commit()
    clear_user_session(user_id=user.id)
    if user.team_id:
        clear_team_session(team_id=user.team_id)
    clear_standings()
    clear_challenges()
    audit("user.moderate", actor, "user", user.id, user.name,
          requested=changes, applied=applied)
    return jsonify({"success": True, "data": _user_json(user)})


@bp.route("/api/v1/manager/teams/<int:team_id>", methods=["PATCH"])
@manager_required
def moderate_team(team_id):
    team = Teams.query.filter_by(id=team_id).first()
    if team is None:
        return _error(404, "No team with this id")
    changes, error = _moderation_changes()
    if error is not None:
        return error
    actor = get_current_user()
    if actor.team_id == team.id:
        refusal = "You cannot moderate your own team"
    elif any(is_manager(m) for m in team.members) and ROLE_ADMIN not in get_roles(actor):
        refusal = "Only an admin can moderate a team with a manager or an admin"
    else:
        refusal = None
    if refusal:
        audit("team.moderate.denied", actor, "team", team.id, team.name,
              requested=changes, reason=refusal)
        return _error(403, refusal)
    applied = _apply(team, changes)
    db.session.commit()
    clear_team_session(team_id=team.id)
    for member in team.members:
        clear_user_session(user_id=member.id)
    clear_standings()
    clear_challenges()
    audit("team.moderate", actor, "team", team.id, team.name,
          requested=changes, applied=applied)
    return jsonify({"success": True, "data": _team_json(team)})


SUBMISSION_TYPES = ("correct", "incorrect", "partial", "discard", "ratelimited")


def _submission_json(s):
    return {
        "id": s.id,
        "type": s.type,
        "challenge_id": s.challenge_id,
        "challenge_name": s.challenge.name if s.challenge else None,
        "user_id": s.user_id,
        "user_name": s.user.name if s.user else None,
        "team_id": s.team_id,
        "team_name": s.team.name if s.team else None,
        "provided": (s.provided or "")[:200],
        "date": _iso(s.date),
    }


@bp.route("/api/v1/manager/submissions", methods=["GET"])
@manager_required
def list_submissions():
    try:
        page, per_page = _paging()
        filters = {}
        for key in ("challenge_id", "user_id", "team_id"):
            if request.args.get(key):
                filters[key] = int(request.args[key])
    except ValueError as exc:
        return _error(400, str(exc) if "page" in str(exc) else "ids must be integers")
    stype = request.args.get("type")
    if stype and stype not in SUBMISSION_TYPES:
        return _error(400, f"type must be one of: {', '.join(SUBMISSION_TYPES)}")
    query = Submissions.query
    if stype:
        query = query.filter(Submissions.type == stype)
    for key, value in filters.items():
        query = query.filter(getattr(Submissions, key) == value)
    return _page_response(
        query.order_by(Submissions.date.desc(), Submissions.id.desc()),
        page, per_page, _submission_json,
    )


@bp.route("/api/v1/manager/submissions/<int:submission_id>", methods=["DELETE"])
@manager_required
def delete_submission(submission_id):
    submission = Submissions.query.filter_by(id=submission_id).first()
    if submission is None:
        return _error(404, "No submission with this id")
    actor = get_current_user()
    details = _submission_json(submission)
    details.pop("provided")  # le flag soumis n'est jamais journalisé
    account_id, challenge_id = submission.account_id, submission.challenge_id
    db.session.delete(submission)
    db.session.commit()
    cache.delete(f"account_kpm_{account_id}_{challenge_id}")
    clear_standings()
    clear_challenges()
    audit("submission.invalidate", actor, "submission", submission_id,
          details["challenge_name"], submission=details)
    return jsonify({"success": True, "data": {"id": submission_id}})


def _award_json(a):
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "category": a.category,
        "value": a.value,
        "user_id": a.user_id,
        "user_name": a.user.name if a.user else None,
        "team_id": a.team_id,
        "team_name": a.team.name if a.team else None,
        "date": _iso(a.date),
    }


@bp.route("/api/v1/manager/awards", methods=["GET"])
@manager_required
def list_awards():
    try:
        page, per_page = _paging()
    except ValueError as exc:
        return _error(400, str(exc))
    return _page_response(
        Awards.query.order_by(Awards.date.desc(), Awards.id.desc()),
        page, per_page, _award_json,
    )


@bp.route("/api/v1/manager/awards/<int:award_id>", methods=["DELETE"])
@manager_required
def delete_award(award_id):
    award = Awards.query.filter_by(id=award_id).first()
    if award is None:
        return _error(404, "No award with this id")
    actor = get_current_user()
    details = _award_json(award)
    db.session.delete(award)
    db.session.commit()
    clear_standings()
    audit("award.invalidate", actor, "award", award_id, details["name"], award=details)
    return jsonify({"success": True, "data": {"id": award_id}})


def load(app):
    app.register_blueprint(bp)
