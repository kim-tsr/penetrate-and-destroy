"""manager_api : modération (comptes, équipes, soumissions, awards) et audit."""

import json
import logging

import pytest

from CTFd.models import Awards, Solves, Submissions, Teams, UserTokens, Users, db
from tests.helpers import gen_award, gen_challenge, gen_fail, gen_solve, gen_team, gen_user
from tests.pad.conftest import sso_login, token_headers

BASE = "/api/v1/manager"


class AuditCapture(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.records = []

    def emit(self, record):
        self.records.append(json.loads(record.getMessage()))


@pytest.fixture
def audit_log():
    handler = AuditCapture()
    logger = logging.getLogger("pad.audit")
    logger.addHandler(handler)
    yield handler.records
    logger.removeHandler(handler)


def _login(app, sub, groups):
    """(token, user_id) ; client neuf (le cookie de session primerait sur le token)."""
    _, body = sso_login(app.test_client(), sub=sub, email=f"{sub}@example.org",
                        username=sub, groups=groups)
    return body["data"]["token"], body["data"]["user"]["id"]


def call(app, method, url, token, **kwargs):
    return getattr(app.test_client(), method)(url, headers=token_headers(token), **kwargs)


# --------------------------------------------------------------------------
# Autorisations
# --------------------------------------------------------------------------


ROUTES = (
    ("get", "/users"), ("get", "/teams"), ("get", "/submissions"), ("get", "/awards"),
    ("patch", "/users/1"), ("patch", "/teams/1"),
    ("delete", "/submissions/1"), ("delete", "/awards/1"),
)


def test_moderation_requires_manager(app):
    with app.app_context():
        player, _ = _login(app, "pl", ["ctf-players"])
        for method, path in ROUTES:
            # (sans header Authorization, CTFd refuse d'abord les requêtes mutantes
            # par 403 CSRF ; avec un token invalide la réponse est 401.)
            anon = call(app, method, BASE + path, "ctfd_invalide", json={"banned": True})
            assert anon.status_code == 401, path
            assert anon.get_json()["success"] is False
            resp = call(app, method, BASE + path, player, json={"banned": True})
            assert resp.status_code == 403, path
            assert resp.get_json()["success"] is False


# --------------------------------------------------------------------------
# Listes
# --------------------------------------------------------------------------


def test_list_users_filters_and_paging(app):
    with app.app_context():
        mgr, _ = _login(app, "mgr", ["ctf-managers"])
        gen_user(db, name="alice", email="alice@x.org")
        gen_user(db, name="bob", email="bob@x.org", banned=True)
        gen_user(db, name="ghost_1", email="g@x.org", hidden=True)

        body = call(app, "get", f"{BASE}/users", mgr).get_json()
        # 5 = admin du harnais + mgr + alice + bob + ghost_1
        assert body["meta"]["total"] == 5 and body["meta"]["page"] == 1
        row = {u["name"]: u for u in body["data"]}["mgr"]
        assert row["roles"] == ["manager"] and row["hidden"] is True  # masqué par sso_bridge
        assert "password" not in row

        q = call(app, "get", f"{BASE}/users?q=ALI", mgr).get_json()
        assert [u["name"] for u in q["data"]] == ["alice"]
        assert [u["name"] for u in call(app, "get", f"{BASE}/users?q=x.org", mgr).get_json()["data"]
                ] == ["alice", "bob", "ghost_1"]
        # Les jokers LIKE sont échappés.
        assert call(app, "get", f"{BASE}/users?q=%25", mgr).get_json()["data"] == []
        assert [u["name"] for u in call(app, "get", f"{BASE}/users?banned=true", mgr)
                .get_json()["data"]] == ["bob"]
        assert [u["name"] for u in call(app, "get", f"{BASE}/users?q=ghost&hidden=true", mgr)
                .get_json()["data"]] == ["ghost_1"]

        page2 = call(app, "get", f"{BASE}/users?per_page=3&page=2", mgr).get_json()
        assert page2["meta"] == {"page": 2, "per_page": 3, "total": 5, "count": 2}
        for bad in ("per_page=0", "per_page=201", "page=0", "page=x", "banned=maybe"):
            assert call(app, "get", f"{BASE}/users?{bad}", mgr).status_code == 400, bad


def test_list_teams(teams_app):
    with teams_app.app_context():
        mgr, _ = _login(teams_app, "mgr", ["ctf-managers"])
        gen_team(db, name="blue", email="b@x.org", member_count=3)
        gen_team(db, name="red", email="r@x.org", member_count=1, banned=True)
        data = call(teams_app, "get", f"{BASE}/teams", mgr).get_json()["data"]
        assert [(t["name"], t["member_count"], t["banned"]) for t in data] == [
            ("blue", 3, False), ("red", 1, True)]
        assert data[0]["captain_id"] is not None
        only = call(teams_app, "get", f"{BASE}/teams?banned=true", mgr).get_json()["data"]
        assert [t["name"] for t in only] == ["red"]


# --------------------------------------------------------------------------
# Bannir / masquer
# --------------------------------------------------------------------------


def test_ban_unban_hide_user_is_audited(app, audit_log):
    with app.app_context():
        mgr, mgr_id = _login(app, "mgr", ["ctf-managers"])
        player_token, player_id = _login(app, "pl", ["ctf-players"])
        assert UserTokens.query.filter_by(user_id=player_id).count() == 1

        resp = call(app, "patch", f"{BASE}/users/{player_id}", mgr, json={"banned": True})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["data"]["banned"] is True
        # Le ban révoque les tokens et bloque le token déjà émis comme un nouvel échange SSO.
        assert UserTokens.query.filter_by(user_id=player_id).count() == 0
        assert call(app, "get", "/api/v1/pad/event", player_token).status_code == 401
        assert sso_login(app.test_client(), sub="pl", email="pl@example.org",
                         username="pl")[0] == 403

        resp = call(app, "patch", f"{BASE}/users/{player_id}", mgr,
                    json={"banned": False, "hidden": True})
        data = resp.get_json()["data"]
        assert data["banned"] is False and data["hidden"] is True
        assert Users.query.filter_by(id=player_id).first().hidden is True

        last = audit_log[-1]
        assert last["event"] == "pad.audit" and last["action"] == "user.moderate"
        assert last["actor_id"] == mgr_id and last["actor_name"] == "mgr"
        assert last["target_kind"] == "user" and last["target_id"] == player_id
        assert last["target_name"] == "pl"
        assert last["requested"] == {"banned": False, "hidden": True}
        assert last["applied"] == {"banned": False, "hidden": True}
        assert "email" not in json.dumps(last)
        assert [r["applied"] for r in audit_log if r["action"] == "user.moderate"][0] == {
            "banned": True}

        # Idempotent : rien à appliquer, mais l'action reste tracée.
        call(app, "patch", f"{BASE}/users/{player_id}", mgr, json={"hidden": True})
        assert audit_log[-1]["applied"] == {}


def test_moderation_validation(app):
    with app.app_context():
        mgr, _ = _login(app, "mgr", ["ctf-managers"])
        _, pid = _login(app, "pl", ["ctf-players"])
        url = f"{BASE}/users/{pid}"
        assert call(app, "patch", url, mgr, json={}).status_code == 400
        assert call(app, "patch", url, mgr, json={"banned": "yes"}).status_code == 400
        assert call(app, "patch", url, mgr, json={"name": "x"}).status_code == 400
        assert call(app, "patch", url, mgr, data="pas du json").status_code == 400
        assert call(app, "patch", f"{BASE}/users/9999", mgr, json={"banned": True}).status_code == 404
        assert call(app, "patch", f"{BASE}/teams/9999", mgr, json={"banned": True}).status_code == 404


def test_moderation_protects_self_managers_and_admins(app, audit_log):
    with app.app_context():
        mgr, mgr_id = _login(app, "mgr", ["ctf-managers"])
        _, other_id = _login(app, "mgr2", ["ctf-managers"])
        admin, admin_id = _login(app, "adm", ["ctf-admins"])

        for target in (mgr_id, other_id, admin_id):
            resp = call(app, "patch", f"{BASE}/users/{target}", mgr, json={"banned": True})
            assert resp.status_code == 403, target
            assert resp.get_json()["success"] is False
        assert Users.query.filter_by(banned=True).count() == 0
        assert [r["action"] for r in audit_log].count("user.moderate.denied") == 3

        # Un admin peut modérer un manager, mais pas lui-même.
        assert call(app, "patch", f"{BASE}/users/{other_id}", admin,
                    json={"banned": True}).status_code == 200
        assert call(app, "patch", f"{BASE}/users/{admin_id}", admin,
                    json={"banned": True}).status_code == 403


def test_ban_and_hide_team(teams_app, audit_log):
    with teams_app.app_context():
        mgr, mgr_id = _login(teams_app, "mgr", ["ctf-managers"])
        team = gen_team(db, name="blue", email="b@x.org", member_count=2)
        resp = call(teams_app, "patch", f"{BASE}/teams/{team.id}", mgr,
                    json={"banned": True, "hidden": True})
        assert resp.status_code == 200
        assert resp.get_json()["data"]["banned"] is True
        assert Teams.query.filter_by(id=team.id).first().hidden is True
        last = audit_log[-1]
        assert last["action"] == "team.moderate" and last["target_kind"] == "team"
        assert last["actor_id"] == mgr_id and last["target_name"] == "blue"
        assert last["applied"] == {"banned": True, "hidden": True}

        # Un joueur de l'équipe bannie est refusé même avec un token valide.
        member_token, member_id = _login(teams_app, "mem", ["ctf-players"])
        Users.query.filter_by(id=member_id).update({"team_id": team.id})
        db.session.commit()
        assert call(teams_app, "get", "/api/v1/pad/event", member_token).status_code == 403


def test_team_with_manager_is_admin_only(teams_app):
    with teams_app.app_context():
        mgr, _ = _login(teams_app, "mgr", ["ctf-managers"])
        admin, _ = _login(teams_app, "adm", ["ctf-admins"])
        team = gen_team(db, name="blue", email="b@x.org", member_count=1)
        _, boss_id = _login(teams_app, "boss", ["ctf-managers"])
        Users.query.filter_by(id=boss_id).update({"team_id": team.id})
        db.session.commit()
        assert call(teams_app, "patch", f"{BASE}/teams/{team.id}", mgr,
                    json={"hidden": True}).status_code == 403
        assert call(teams_app, "patch", f"{BASE}/teams/{team.id}", admin,
                    json={"hidden": True}).status_code == 200


def test_manager_cannot_moderate_own_team(teams_app):
    with teams_app.app_context():
        mgr, mgr_id = _login(teams_app, "mgr", ["ctf-managers"])
        team = gen_team(db, name="blue", email="b@x.org", member_count=1)
        Users.query.filter_by(id=mgr_id).update({"team_id": team.id})
        db.session.commit()
        assert call(teams_app, "patch", f"{BASE}/teams/{team.id}", mgr,
                    json={"banned": True}).status_code == 403


# --------------------------------------------------------------------------
# Soumissions et awards
# --------------------------------------------------------------------------


def test_list_and_invalidate_submissions(app, audit_log):
    with app.app_context():
        mgr, mgr_id = _login(app, "mgr", ["ctf-managers"])
        chal = gen_challenge(db, name="c1")
        user = gen_user(db, name="u0", email="u0@x.org")
        solve = gen_solve(db, user_id=user.id, challenge_id=chal.id, provided="PAD{secret}")
        fail = gen_fail(db, user_id=user.id, challenge_id=chal.id)
        solve_id, fail_id = solve.id, fail.id

        body = call(app, "get", f"{BASE}/submissions", mgr).get_json()
        assert body["meta"]["total"] == 2
        assert {s["id"]: s["type"] for s in body["data"]} == {solve_id: "correct", fail_id: "incorrect"}
        assert body["data"][0]["challenge_name"] == "c1" and body["data"][0]["user_name"] == "u0"
        only = call(app, "get", f"{BASE}/submissions?type=correct&user_id={user.id}", mgr).get_json()
        assert [s["id"] for s in only["data"]] == [solve_id]
        assert call(app, "get", f"{BASE}/submissions?type=zzz", mgr).status_code == 400
        assert call(app, "get", f"{BASE}/submissions?user_id=x", mgr).status_code == 400
        assert call(app, "get", f"{BASE}/submissions?per_page=0", mgr).status_code == 400

        resp = call(app, "delete", f"{BASE}/submissions/{solve_id}", mgr)
        assert resp.status_code == 200 and resp.get_json()["data"] == {"id": solve_id}
        assert Solves.query.count() == 0 and Submissions.query.count() == 1
        assert call(app, "delete", f"{BASE}/submissions/{solve_id}", mgr).status_code == 404

        entry = [r for r in audit_log if r["action"] == "submission.invalidate"][0]
        assert entry["actor_id"] == mgr_id and entry["target_id"] == solve_id
        assert entry["submission"]["type"] == "correct"
        assert entry["submission"]["user_name"] == "u0"
        assert "PAD{secret}" not in json.dumps(entry)  # le flag soumis n'est jamais journalisé


def test_invalidated_solve_leaves_the_scoreboard_and_first_blood(app):
    with app.app_context():
        mgr, _ = _login(app, "mgr", ["ctf-managers"])
        player, _ = _login(app, "pl", ["ctf-players"])
        chal = gen_challenge(db, name="c1")
        user = gen_user(db, name="cheat", email="c@x.org")
        solve_id = gen_solve(db, user_id=user.id, challenge_id=chal.id).id
        first = call(app, "get", "/api/v1/pad/first-bloods", player).get_json()["data"]
        assert [r["account_name"] for r in first] == ["cheat"]
        call(app, "delete", f"{BASE}/submissions/{solve_id}", mgr)
        assert call(app, "get", "/api/v1/pad/first-bloods", player).get_json()["data"] == []


def test_list_and_invalidate_awards(app, audit_log):
    with app.app_context():
        mgr, _ = _login(app, "mgr", ["ctf-managers"])
        user = gen_user(db, name="u0", email="u0@x.org")
        award = gen_award(db, user_id=user.id, name="bonus", value=50)
        award_id = award.id
        data = call(app, "get", f"{BASE}/awards", mgr).get_json()
        assert data["meta"]["total"] == 1
        assert data["data"][0]["name"] == "bonus" and data["data"][0]["user_name"] == "u0"
        assert data["data"][0]["value"] == 50

        assert call(app, "delete", f"{BASE}/awards/{award_id}", mgr).status_code == 200
        assert Awards.query.count() == 0
        assert call(app, "delete", f"{BASE}/awards/{award_id}", mgr).status_code == 404
        entry = [r for r in audit_log if r["action"] == "award.invalidate"][0]
        assert entry["target_id"] == award_id and entry["award"]["value"] == 50
