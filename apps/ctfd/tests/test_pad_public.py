"""pad_public : événement lisible par les joueurs et first blood."""

import datetime
import time

from CTFd.models import Users, db
from CTFd.utils import set_config
from tests.helpers import gen_challenge, gen_solve, gen_team, gen_user
from tests.pad.conftest import sso_login, token_headers


def _token(client, sub, groups=("ctf-players",)):
    _, body = sso_login(client, sub=sub, email=f"{sub}@example.org",
                        username=sub, groups=groups)
    return body["data"]["token"], body["data"]["user"]["id"]


def _solve_at(user_id, challenge_id, when, team_id=None):
    solve = gen_solve(db, user_id=user_id, team_id=team_id, challenge_id=challenge_id)
    solve.date = when
    db.session.commit()
    return solve


# --------------------------------------------------------------------------
# GET /api/v1/pad/event
# --------------------------------------------------------------------------


def test_event_requires_authentication(app):
    with app.app_context():
        client = app.test_client()
        assert client.get("/api/v1/pad/event").status_code == 401
        resp = client.get("/api/v1/pad/event",
                          headers={"Authorization": "Token ctfd_bad"})
        assert resp.status_code == 401


def test_event_readable_by_a_player(app):
    with app.app_context():
        client = app.test_client()
        token, _ = _token(client, "p1")
        now = int(time.time())
        set_config("start", now - 100)
        set_config("end", now + 1000)
        set_config("freeze", now + 500)
        client = app.test_client()
        resp = client.get("/api/v1/pad/event", headers=token_headers(token))
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["start"] == now - 100 and data["end"] == now + 1000
        assert data["freeze"] == now + 500
        assert data["paused"] is False and data["state"] == "running"
        assert abs(data["server_time"] - now) <= 5


def test_event_states_and_defaults(app):
    with app.app_context():
        client = app.test_client()
        token, _ = _token(client, "p1")
        headers = token_headers(token)

        def state():
            return app.test_client().get("/api/v1/pad/event", headers=headers).get_json()["data"]

        empty = state()
        assert empty["start"] is None and empty["end"] is None
        assert empty["freeze"] is None and empty["state"] == "running"
        now = int(time.time())
        set_config("start", now + 3600)
        assert state()["state"] == "not_started"
        set_config("start", now - 3600)
        set_config("freeze", now - 60)
        assert state()["state"] == "frozen"
        set_config("paused", True)
        assert state()["state"] == "paused"
        set_config("end", now - 10)
        assert state()["state"] == "ended"


def test_event_banned_player_refused(app):
    with app.app_context():
        client = app.test_client()
        token, uid = _token(client, "p1")
        Users.query.filter_by(id=uid).update({"banned": True})
        db.session.commit()
        resp = app.test_client().get("/api/v1/pad/event", headers=token_headers(token))
        assert resp.status_code == 403


# --------------------------------------------------------------------------
# GET /api/v1/pad/first-bloods
# --------------------------------------------------------------------------


def test_first_blood_users_mode(app):
    with app.app_context():
        client = app.test_client()
        token, me = _token(client, "me")
        c1 = gen_challenge(db, name="c1")
        c2 = gen_challenge(db, name="c2")
        gen_challenge(db, name="c3-unsolved")
        hidden = gen_challenge(db, name="c4", state="hidden")
        now = datetime.datetime.utcnow()
        early = gen_user(db, name="early", email="e@x.org")
        late = gen_user(db, name="late", email="l@x.org")
        _solve_at(late.id, c1.id, now - datetime.timedelta(hours=1))
        _solve_at(early.id, c1.id, now - datetime.timedelta(hours=3))
        _solve_at(me, c2.id, now - datetime.timedelta(hours=2))
        _solve_at(early.id, hidden.id, now - datetime.timedelta(hours=2))

        resp = app.test_client().get("/api/v1/pad/first-bloods", headers=token_headers(token))
        assert resp.status_code == 200
        by_id = {r["challenge_id"]: r for r in resp.get_json()["data"]}
        assert set(by_id) == {c1.id, c2.id}  # ni non résolu, ni caché
        assert by_id[c1.id]["account_id"] == early.id
        assert by_id[c1.id]["account_name"] == "early"
        assert by_id[c1.id]["user_name"] == "early"
        assert by_id[c1.id]["date"].endswith("Z")
        assert by_id[c2.id]["account_id"] == me

        only = app.test_client().get(f"/api/v1/pad/first-bloods?challenge_id={c1.id}",
                                     headers=token_headers(token)).get_json()["data"]
        assert [r["challenge_id"] for r in only] == [c1.id]
        assert app.test_client().get("/api/v1/pad/first-bloods?challenge_id=abc",
                                     headers=token_headers(token)).status_code == 400
        assert app.test_client().get("/api/v1/pad/first-bloods").status_code == 401


def test_first_blood_skips_hidden_banned_accounts(app):
    with app.app_context():
        client = app.test_client()
        token, _ = _token(client, "me")
        c1 = gen_challenge(db, name="c1")
        now = datetime.datetime.utcnow()
        ghost = gen_user(db, name="ghost", email="g@x.org", hidden=True)
        cheat = gen_user(db, name="cheat", email="c@x.org", banned=True)
        honest = gen_user(db, name="honest", email="h@x.org")
        _solve_at(ghost.id, c1.id, now - datetime.timedelta(hours=5))
        _solve_at(cheat.id, c1.id, now - datetime.timedelta(hours=4))
        _solve_at(honest.id, c1.id, now - datetime.timedelta(hours=1))
        data = app.test_client().get("/api/v1/pad/first-bloods",
                                     headers=token_headers(token)).get_json()["data"]
        assert [r["account_name"] for r in data] == ["honest"]


def test_first_blood_teams_mode_reports_the_team(teams_app):
    with teams_app.app_context():
        client = teams_app.test_client()
        token, _ = _token(client, "me")
        c1 = gen_challenge(db, name="c1")
        team = gen_team(db, name="blue", email="blue@x.org", member_count=2)
        member = team.members[1]
        _solve_at(member.id, c1.id, datetime.datetime.utcnow(), team_id=team.id)
        data = teams_app.test_client().get("/api/v1/pad/first-bloods",
                                           headers=token_headers(token)).get_json()["data"]
        assert data[0]["account_id"] == team.id
        assert data[0]["account_name"] == "blue"
        assert data[0]["user_id"] == member.id and data[0]["user_name"] == member.name


def test_first_blood_frozen_for_players_not_for_managers(app):
    with app.app_context():
        client = app.test_client()
        player, _ = _token(client, "me")
        manager, _ = _token(client, "mgr", ("ctf-managers",))
        c1 = gen_challenge(db, name="c1")
        now = datetime.datetime.utcnow()
        before = gen_user(db, name="before", email="b@x.org")
        after = gen_user(db, name="after", email="a@x.org")
        frozen_at = int(time.time()) - 3600
        set_config("freeze", frozen_at)
        # Seul un solve postérieur au gel existe pour c2 : invisible des joueurs.
        c2 = gen_challenge(db, name="c2")
        _solve_at(before.id, c1.id, now - datetime.timedelta(hours=2))
        _solve_at(after.id, c2.id, now - datetime.timedelta(minutes=10))

        def ids(token):
            resp = app.test_client().get("/api/v1/pad/first-bloods", headers=token_headers(token))
            return {r["challenge_id"] for r in resp.get_json()["data"]}

        assert ids(player) == {c1.id}
        assert ids(manager) == {c1.id, c2.id}


def test_first_blood_hidden_challenge_visible_to_managers(app):
    with app.app_context():
        client = app.test_client()
        manager, _ = _token(client, "mgr", ("ctf-managers",))
        hidden = gen_challenge(db, name="c4", state="hidden")
        user = gen_user(db, name="u", email="u@x.org")
        _solve_at(user.id, hidden.id, datetime.datetime.utcnow())
        data = app.test_client().get("/api/v1/pad/first-bloods",
                                     headers=token_headers(manager)).get_json()["data"]
        assert [r["challenge_id"] for r in data] == [hidden.id]
