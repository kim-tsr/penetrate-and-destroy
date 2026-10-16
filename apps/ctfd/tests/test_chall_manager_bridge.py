from CTFd.models import Challenges, Flags, db
from tests.pad.conftest import sso_login, token_headers
from tests.pad.fake_cm import FakeChallManager, install


def _admin_token(client):
    _, body = sso_login(client, sub="adm", email="adm@example.org",
                        username="adm", groups=["ctf-admins"])
    return body["data"]["token"]


def _player_token(client, sub="p1", name="p1"):
    _, body = sso_login(client, sub=sub, email=f"{name}@example.org", username=name)
    return body["data"]["token"]


def _create_challenge(client, token, **extra):
    payload = {
        "name": "web-sqli",
        "category": "web",
        "description": "desc",
        "value": 100,
        "state": "visible",
        "type": "dynamic_instance",
        "instance_config": {"image": "registry/pad/web:1", "port": "5000"},
        "timeout": 600,
        "max_renewals": 1,
    }
    payload.update(extra)
    resp = client.post("/api/v1/challenges", json=payload,
                       headers=token_headers(token))
    return resp


def test_challenge_create_syncs_chall_manager(app):
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        resp = _create_challenge(client, _admin_token(client))
        assert resp.status_code == 200, resp.get_json()
        cid = str(resp.get_json()["data"]["id"])
        assert fake.challenges[cid]["scenario"] == app.config["PAD_GENERIC_SCENARIO"]
        assert fake.challenges[cid]["timeout"] == "600s"
        assert fake.challenges[cid]["additional"]["image"] == "registry/pad/web:1"

        # Mise à jour -> PATCH chall-manager
        resp = client.patch(f"/api/v1/challenges/{cid}", json={"timeout": 900},
                            headers=token_headers(_admin_token(client)))
        assert resp.status_code == 200
        assert fake.challenges[cid]["timeout"] == "900s"

        # Suppression -> DELETE chall-manager
        resp = client.delete(f"/api/v1/challenges/{cid}",
                             headers=token_headers(_admin_token(client)))
        assert resp.status_code == 200
        assert cid not in fake.challenges


def test_challenge_create_rolls_back_when_chall_manager_down(app):
    fake = FakeChallManager(down=True)
    with app.app_context(), install(fake):
        client = app.test_client()
        resp = _create_challenge(client, _admin_token(client))
        assert resp.status_code in (400, 500)
        assert Challenges.query.count() == 0


def test_player_instance_lifecycle(app):
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        cid = _create_challenge(client, _admin_token(client)).get_json()["data"]["id"]
        token = _player_token(client)
        h = token_headers(token)
        # Sans Content-Type JSON (GET/DELETE) : le token reste accepté.
        bare = {"Authorization": f"Token {token}"}

        assert client.get(f"/api/v1/instances/{cid}", headers=bare).status_code == 404

        resp = client.post(f"/api/v1/instances/{cid}", headers=h)
        assert resp.status_code == 201, resp.get_json()
        data = resp.get_json()["data"]
        assert data["connection_info"].startswith("nc ")
        assert data["source_id"].startswith("user-")
        assert 0 < data["expires_in"] <= 600
        assert data["renewals_left"] == 1
        assert "flags" not in data
        sent = fake.calls[-1][2]
        assert sent["additional"]["pad_source_kind"] == "user"

        assert client.post(f"/api/v1/instances/{cid}", headers=h).status_code == 409

        listing = client.get("/api/v1/instances", headers=bare).get_json()["data"]
        assert [i["challenge_id"] for i in listing] == [cid]

        resp = client.patch(f"/api/v1/instances/{cid}", headers=h)
        assert resp.status_code == 200
        assert resp.get_json()["data"]["renewals_left"] == 0
        assert client.patch(f"/api/v1/instances/{cid}", headers=h).status_code == 429

        assert client.delete(f"/api/v1/instances/{cid}", headers=bare).status_code == 200
        assert fake.instances == {}


def test_instances_require_auth(app):
    with app.app_context(), install(FakeChallManager()):
        client = app.test_client()
        assert client.get("/api/v1/instances").status_code in (401, 403)
        assert client.post("/api/v1/instances/1", json={}).status_code in (401, 403)


def test_hidden_challenge_not_instantiable(app):
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        cid = _create_challenge(client, _admin_token(client), state="hidden") \
            .get_json()["data"]["id"]
        h = token_headers(_player_token(client))
        assert client.post(f"/api/v1/instances/{cid}", headers=h).status_code == 404


def test_quota_and_cooldown(app):
    app.config["PAD_INSTANCES_MAX_PER_SOURCE"] = "1"
    app.config["PAD_INSTANCES_COOLDOWN_SECONDS"] = "0"
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        admin = _admin_token(client)
        c1 = _create_challenge(client, admin).get_json()["data"]["id"]
        c2 = _create_challenge(client, admin, name="other").get_json()["data"]["id"]
        h = token_headers(_player_token(client))
        assert client.post(f"/api/v1/instances/{c1}", headers=h).status_code == 201
        assert client.post(f"/api/v1/instances/{c2}", headers=h).status_code == 429

    app.config["PAD_INSTANCES_MAX_PER_SOURCE"] = "5"
    app.config["PAD_INSTANCES_COOLDOWN_SECONDS"] = "60"
    with app.app_context(), install(fake):
        client = app.test_client()
        h = token_headers(_player_token(client, sub="p2", name="p2"))
        assert client.post(f"/api/v1/instances/{c1}", headers=h).status_code == 201
        assert client.post(f"/api/v1/instances/{c2}", headers=h).status_code == 429


def test_per_instance_flag_and_destroy_on_solve(app):
    fake = FakeChallManager(flags=["PAD{instance-specific}"])
    with app.app_context(), install(fake):
        client = app.test_client()
        cid = _create_challenge(client, _admin_token(client),
                                per_instance_flag=True).get_json()["data"]["id"]
        # Un flag statique ne doit pas être accepté en mode flag par instance.
        db.session.add(Flags(challenge_id=cid, type="static", content="PAD{static}"))
        db.session.commit()
        h = token_headers(_player_token(client))

        attempt = {"challenge_id": cid, "submission": "PAD{instance-specific}"}
        resp = client.post("/api/v1/challenges/attempt", json=attempt, headers=h)
        assert resp.get_json()["data"]["status"] == "incorrect"  # pas d'instance

        client.post(f"/api/v1/instances/{cid}", headers=h)
        bad = {"challenge_id": cid, "submission": "PAD{static}"}
        resp = client.post("/api/v1/challenges/attempt", json=bad, headers=h)
        assert resp.get_json()["data"]["status"] == "incorrect"

        resp = client.post("/api/v1/challenges/attempt", json=attempt, headers=h)
        assert resp.get_json()["data"]["status"] == "correct"
        assert fake.instances == {}  # détruite après le solve


def test_teams_mode_requires_team_and_uses_team_source(teams_app):
    fake = FakeChallManager()
    app = teams_app
    with app.app_context(), install(fake):
        client = app.test_client()
        cid = _create_challenge(client, _admin_token(client)).get_json()["data"]["id"]
        token = _player_token(client)
        h = token_headers(token)
        assert client.post(f"/api/v1/instances/{cid}", headers=h).status_code == 403

        resp = client.post("/api/v1/pad/teams", json={"name": "red", "password": "pw"},
                           headers=h)
        assert resp.status_code == 201, resp.get_json()
        resp = client.post(f"/api/v1/instances/{cid}", headers=h)
        assert resp.status_code == 201
        assert resp.get_json()["data"]["source_id"].startswith("team-")


def test_challenge_read_hides_scenario_from_players(app):
    with app.app_context(), install(FakeChallManager()):
        client = app.test_client()
        cid = _create_challenge(client, _admin_token(client),
                                scenario="registry/x:1").get_json()["data"]["id"]
        data = client.get(f"/api/v1/challenges/{cid}",
                          headers=token_headers(_player_token(client))).get_json()
        assert "scenario" not in data["data"]
        assert data["data"]["instance"]["timeout"] == 600
