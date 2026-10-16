"""pad_public : endpoints en lecture pour tout joueur authentifié (token API).

    GET /api/v1/pad/event         dates, gel, pause et état de l'événement
    GET /api/v1/pad/first-bloods  premier solve de chaque challenge visible

Voir apps/ctfd/API.md. Les managers disposent de GET /api/v1/manager/event
(identique) et voient aussi les challenges cachés et les solves gelés.
"""

import time

from flask import Blueprint, jsonify, request

from CTFd.models import Challenges, Solves
from CTFd.plugins.pad_common.auth import token_authed
from CTFd.plugins.pad_common.event import event_json
from CTFd.plugins.pad_common.roles import is_manager
from CTFd.plugins.pad_common.scores import (
    first_blood_json,
    utc_naive,
    visible_solves,
)
from CTFd.utils.user import get_current_user

bp = Blueprint("pad_public", __name__)


def _error(status, message):
    resp = jsonify({"success": False, "errors": {"_": [message]}})
    resp.status_code = status
    return resp


@bp.route("/api/v1/pad/event", methods=["GET"])
@token_authed
def get_event():
    now = time.time()
    data = event_json(now)
    data["server_time"] = int(now)
    return jsonify({"success": True, "data": data})


@bp.route("/api/v1/pad/first-bloods", methods=["GET"])
@token_authed
def first_bloods():
    """Premier solve par challenge, parmi les comptes visibles.

    Joueurs : challenges `visible` uniquement, et solves antérieurs au gel du
    scoreboard (sinon un first blood pris pendant le gel fuiterait).
    `?challenge_id=` restreint à un challenge.
    """
    challenge_id = request.args.get("challenge_id")
    if challenge_id is not None:
        try:
            challenge_id = int(challenge_id)
        except ValueError:
            return _error(400, "challenge_id must be an integer")

    query = visible_solves(challenge_id)
    hidden = set()
    if not is_manager(get_current_user()):
        hidden = {
            row[0]
            for row in Challenges.query.with_entities(Challenges.id).filter(
                Challenges.state != "visible"
            )
        }
        freeze = event_json()["freeze"]
        if freeze:
            query = query.filter(Solves.date <= utc_naive(freeze))

    seen = {}
    for solve in query:
        if solve.challenge_id in hidden or solve.challenge_id in seen:
            continue
        item = first_blood_json(solve)
        item["challenge_id"] = solve.challenge_id
        seen[solve.challenge_id] = item
    return jsonify({"success": True, "data": list(seen.values())})


def load(app):
    app.register_blueprint(bp)
