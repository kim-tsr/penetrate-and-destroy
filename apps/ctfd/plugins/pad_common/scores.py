"""Requêtes de score partagées : solves visibles et first blood.

« Visible » = comptes ni bannis ni cachés (managers inclus, ils sont masqués
par `sso_bridge`), comme le scoreboard CTFd.
"""

import datetime

from CTFd.models import Solves, Teams, Users, db
from CTFd.utils import get_config
from CTFd.utils.modes import TEAMS_MODE


def iso(dt):
    if dt is None:
        return None
    return dt.replace(microsecond=0, tzinfo=None).isoformat() + "Z"


def utc_naive(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).replace(
        tzinfo=None
    )


def visible_solves(challenge_id=None):
    """Requête des solves de comptes visibles, du plus ancien au plus récent."""
    q = db.session.query(Solves).join(Users, Solves.user_id == Users.id).filter(
        Users.banned.is_(False), Users.hidden.is_(False)
    )
    if challenge_id is not None:
        q = q.filter(Solves.challenge_id == challenge_id)
    if get_config("user_mode") == TEAMS_MODE:
        q = q.join(Teams, Solves.team_id == Teams.id).filter(
            Teams.banned.is_(False), Teams.hidden.is_(False)
        )
    return q.order_by(Solves.date, Solves.id)


def first_blood_json(solve):
    """Compte (équipe en mode équipes, joueur sinon) et joueur du solve."""
    teams_mode = get_config("user_mode") == TEAMS_MODE
    return {
        "account_id": solve.team_id if teams_mode else solve.user_id,
        "account_name": solve.team.name if teams_mode and solve.team else solve.user.name,
        "user_id": solve.user_id,
        "user_name": solve.user.name,
        "date": iso(solve.date),
    }
