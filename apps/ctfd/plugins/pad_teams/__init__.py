"""pad_teams : gestion d'équipe headless et lookup interne pour netbird-sync.

CTFd 3.8 ne propose la création et l'adhésion d'équipe qu'en formulaires HTML
(/teams/new, /teams/join) ; l'API REST native réserve POST /api/v1/teams aux
admins. Ce plugin expose l'équivalent JSON pour le BFF (token API) :

    POST /api/v1/pad/teams        {"name", "password"}  crée l'équipe (capitaine)
    POST /api/v1/pad/teams/join   {"name", "password"}  rejoint une équipe
    POST /api/v1/pad/teams/leave  {}                    quitte l'équipe

et, pour netbird-sync (token de service PAD_INTERNAL_TOKEN, Bearer) :

    GET /api/v1/pad/internal/sources/<team|user>/<id>
        -> {"kind", "id", "name", "members": [{"id", "email"}]}
"""

import hmac

from flask import Blueprint, abort, jsonify, request

from CTFd.cache import clear_standings, clear_team_session, clear_user_session
from CTFd.models import Solves, Teams, Users, db
from CTFd.plugins import bypass_csrf_protection
from CTFd.plugins.pad_common import ratelimit
from CTFd.plugins.pad_common.auth import ensure_token_login
from CTFd.plugins.pad_common.settings import setting, setting_int
from CTFd.utils import get_config
from CTFd.utils.crypto import verify_password
from CTFd.utils.modes import TEAMS_MODE

bp = Blueprint("pad_teams", __name__)


def _error(status, message):
    resp = jsonify({"success": False, "errors": {"_": [message]}})
    resp.status_code = status
    return resp


def _team_json(team):
    return {
        "id": team.id,
        "name": team.name,
        "captain_id": team.captain_id,
        "members": [{"id": m.id, "name": m.name} for m in team.members],
    }


def _require_player():
    user = ensure_token_login()
    if user is None:
        abort(401, description="Authentication required")
    if get_config("user_mode") != TEAMS_MODE:
        abort(400, description="The CTF is not in teams mode")
    return user


def _payload():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    password = str(data.get("password") or "")
    return name, password


def _too_many(seconds):
    resp = _error(429, "Too many attempts, retry later")
    resp.headers["Retry-After"] = str(max(1, seconds))
    return resp


def _join_limits():
    """(par utilisateur, par équipe cible) : (échecs max, fenêtre s, verrou de base s)."""
    return (
        (
            setting_int("PAD_TEAM_JOIN_USER_MAX_FAILURES", 5),
            setting_int("PAD_TEAM_JOIN_USER_WINDOW_SECONDS", 300),
            setting_int("PAD_TEAM_JOIN_USER_LOCK_SECONDS", 60),
        ),
        (
            setting_int("PAD_TEAM_JOIN_TEAM_MAX_FAILURES", 10),
            setting_int("PAD_TEAM_JOIN_TEAM_WINDOW_SECONDS", 900),
            setting_int("PAD_TEAM_JOIN_TEAM_LOCK_SECONDS", 300),
        ),
    )


def _clear(user, team=None):
    clear_user_session(user_id=user.id)
    if team is not None:
        clear_team_session(team_id=team.id)
    clear_standings()


@bp.route("/api/v1/pad/teams", methods=["POST"])
@bypass_csrf_protection
def create_team():
    user = _require_player()
    if user.team_id:
        return _error(409, "You are already in a team")
    if get_config("team_creation", default=True) is False:
        return _error(403, "Team creation is disabled")
    limit = int(get_config("num_teams", default=0) or 0)
    if limit and Teams.query.filter_by(banned=False, hidden=False).count() >= limit:
        return _error(403, f"Reached the maximum number of teams ({limit})")
    name, password = _payload()
    if not name or len(name) > 128 or not password:
        return _error(400, "Name and password are required")
    if Teams.query.filter_by(name=name).first():
        return _error(409, "That team name is already taken")
    team = Teams(name=name, password=password, captain_id=user.id)
    db.session.add(team)
    db.session.commit()
    user.team_id = team.id
    db.session.commit()
    _clear(user, team)
    return jsonify({"success": True, "data": _team_json(team)}), 201


@bp.route("/api/v1/pad/teams/join", methods=["POST"])
@bypass_csrf_protection
def join_team():
    user = _require_player()
    if user.team_id:
        return _error(409, "You are already in a team")
    name, password = _payload()
    # Brute-force du mot de passe d'équipe : limites côté CTFd (en plus du BFF),
    # par utilisateur ET par équipe cible (nom normalisé, existante ou non, pour
    # ne pas révéler quelles équipes existent), avec backoff exponentiel.
    user_lim, team_lim = _join_limits()
    wait = max(
        ratelimit.retry_after("join:user", user.id),
        ratelimit.retry_after("join:team", name),
    )
    if wait:
        return _too_many(wait)
    team = Teams.query.filter_by(name=name).first()
    if team is None or not verify_password(password, team.password):
        ratelimit.record_failure("join:user", user.id, *user_lim)
        ratelimit.record_failure("join:team", name, *team_lim)
        return _error(403, "That information is incorrect")
    ratelimit.reset("join:user", user.id)
    if team.banned:
        return _error(403, "This team is banned")
    size = int(get_config("team_size", default=0) or 0)
    if size and len(team.members) >= size:
        return _error(403, f"{team.name} has already reached the team size limit")
    user.team_id = team.id
    db.session.commit()
    if team.captain_id is None:
        team.captain_id = user.id
        db.session.commit()
    _clear(user, team)
    return jsonify({"success": True, "data": _team_json(team)})


@bp.route("/api/v1/pad/teams/leave", methods=["POST"])
@bypass_csrf_protection
def leave_team():
    user = _require_player()
    team = Teams.query.filter_by(id=user.team_id).first() if user.team_id else None
    if team is None:
        return _error(404, "You are not in a team")
    if Solves.query.filter_by(user_id=user.id).count():
        return _error(409, "You cannot leave a team after scoring")
    others = [m for m in team.members if m.id != user.id]
    if team.captain_id == user.id and others:
        return _error(409, "Transfer captaincy before leaving the team")
    user.team_id = None
    db.session.commit()
    if not others:
        db.session.delete(team)
        db.session.commit()
    _clear(user, team)
    return jsonify({"success": True, "data": {}})


@bp.route("/api/v1/pad/internal/sources/<kind>/<int:source_id>", methods=["GET"])
def internal_source(kind, source_id):
    expected = setting("PAD_INTERNAL_TOKEN")
    if not expected:
        abort(503, description="Internal token not configured")
    scheme, _, provided = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(
        provided.strip().encode(), expected.encode()
    ):
        abort(401)
    if kind == "team":
        team = Teams.query.filter_by(id=source_id).first_or_404()
        members, name = team.members, team.name
        banned = team.banned
    elif kind == "user":
        user = Users.query.filter_by(id=source_id).first_or_404()
        members, name, banned = [user], user.name, user.banned
    else:
        abort(404)
    return jsonify(
        {
            "success": True,
            "data": {
                "kind": kind,
                "id": source_id,
                "name": name,
                "banned": bool(banned),
                "members": [
                    {"id": m.id, "email": m.email}
                    for m in members
                    if not m.banned
                ],
            },
        }
    )


def load(app):
    app.register_blueprint(bp)
