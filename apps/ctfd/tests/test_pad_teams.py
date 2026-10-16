from CTFd.models import Users
from tests.pad.conftest import sso_login, token_headers


def _player(client, sub):
    _, body = sso_login(client, sub=sub, email=f"{sub}@example.org", username=sub)
    return body["data"]["token"], body["data"]["user"]["id"]


def test_create_join_leave(teams_app):
    with teams_app.app_context():
        client = teams_app.test_client()
        t1, u1 = _player(client, "cap")
        t2, u2 = _player(client, "mate")

        resp = client.post("/api/v1/pad/teams", json={"name": "blue", "password": "s3"},
                           headers=token_headers(t1))
        assert resp.status_code == 201
        team_id = resp.get_json()["data"]["id"]
        assert resp.get_json()["data"]["captain_id"] == u1

        assert client.post("/api/v1/pad/teams", json={"name": "blue", "password": "x"},
                           headers=token_headers(t2)).status_code == 409
        assert client.post("/api/v1/pad/teams/join",
                           json={"name": "blue", "password": "bad"},
                           headers=token_headers(t2)).status_code == 403
        resp = client.post("/api/v1/pad/teams/join",
                           json={"name": "blue", "password": "s3"},
                           headers=token_headers(t2))
        assert resp.status_code == 200
        assert Users.query.filter_by(id=u2).first().team_id == team_id

        # Le capitaine ne peut pas partir en laissant des membres.
        assert client.post("/api/v1/pad/teams/leave", json={},
                           headers=token_headers(t1)).status_code == 409
        assert client.post("/api/v1/pad/teams/leave", json={},
                           headers=token_headers(t2)).status_code == 200


def _join(client, token, name, password):
    return client.post("/api/v1/pad/teams/join",
                       json={"name": name, "password": password},
                       headers=token_headers(token))


def test_join_password_bruteforce_locks_user_with_backoff(teams_app):
    teams_app.config["PAD_TEAM_JOIN_USER_MAX_FAILURES"] = 3
    with teams_app.app_context():
        client = teams_app.test_client()
        cap, _ = _player(client, "cap")
        client.post("/api/v1/pad/teams", json={"name": "red", "password": "good"},
                    headers=token_headers(cap))
        att, _ = _player(client, "att")
        for _ in range(3):
            assert _join(client, att, "red", "bad").status_code == 403
        locked = _join(client, att, "red", "good")  # même le bon mot de passe est refusé
        assert locked.status_code == 429
        assert int(locked.headers["Retry-After"]) >= 1


def test_join_limit_is_per_target_team_across_accounts(teams_app):
    teams_app.config["PAD_TEAM_JOIN_TEAM_MAX_FAILURES"] = 4
    with teams_app.app_context():
        client = teams_app.test_client()
        cap, _ = _player(client, "cap")
        client.post("/api/v1/pad/teams", json={"name": "red", "password": "good"},
                    headers=token_headers(cap))
        # Quatre comptes distincts, un échec chacun : l'équipe cible se verrouille.
        for i in range(4):
            tok, _ = _player(client, f"a{i}")
            assert _join(client, tok, "red", "bad").status_code == 403
        victim, _ = _player(client, "legit")
        assert _join(client, victim, "red", "good").status_code == 429
        # Une autre équipe n'est pas affectée.
        client.post("/api/v1/pad/teams", json={"name": "blue", "password": "ok"},
                    headers=token_headers(_player(client, "cap2")[0]))
        assert _join(client, victim, "blue", "ok").status_code == 200


def test_join_lock_applies_to_unknown_teams_too(teams_app):
    teams_app.config["PAD_TEAM_JOIN_USER_MAX_FAILURES"] = 2
    with teams_app.app_context():
        client = teams_app.test_client()
        tok, _ = _player(client, "scan")
        assert _join(client, tok, "nope1", "x").status_code == 403
        assert _join(client, tok, "nope2", "x").status_code == 403
        assert _join(client, tok, "nope3", "x").status_code == 429


def test_users_mode_rejects_team_endpoints(app):
    with app.app_context():
        client = app.test_client()
        token, _ = _player(client, "solo")
        assert client.post("/api/v1/pad/teams", json={"name": "x", "password": "y"},
                           headers=token_headers(token)).status_code == 400


def test_internal_source_lookup(teams_app):
    with teams_app.app_context():
        client = teams_app.test_client()
        token, uid = _player(client, "cap")
        team_id = client.post("/api/v1/pad/teams", json={"name": "g", "password": "p"},
                              headers=token_headers(token)).get_json()["data"]["id"]
        url = f"/api/v1/pad/internal/sources/team/{team_id}"
        assert client.get(url).status_code == 401
        assert client.get(url, headers={"Authorization": "Bearer bad"}).status_code == 401
        # Un token joueur n'ouvre pas l'endpoint interne.
        assert client.get(url, headers=token_headers(token)).status_code == 401
        resp = client.get(url, headers={"Authorization": "Bearer internal-token"})
        assert resp.status_code == 200
        assert resp.get_json()["data"]["members"] == [
            {"id": uid, "email": "cap@example.org"}
        ]
        assert client.get("/api/v1/pad/internal/sources/team/999",
                          headers={"Authorization": "Bearer internal-token"}
                          ).status_code == 404
