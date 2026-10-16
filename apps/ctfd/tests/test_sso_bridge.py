import time

from CTFd.models import Users, db
from CTFd.plugins.pad_common import roles as pad_roles
from tests.pad.conftest import signed_headers, sso_login, token_headers


def test_session_creates_player_and_token_works(app):
    with app.app_context():
        client = app.test_client()
        status, body = sso_login(client)
        assert status == 200, body
        data = body["data"]
        assert data["created"] is True
        assert data["user"]["type"] == "user"
        assert data["user"]["roles"] == []
        assert data["token"].startswith("ctfd_")
        assert data["ttl"] == 300

        me = client.get("/api/v1/users/me", headers=token_headers(data["token"]))
        assert me.status_code == 200
        assert me.get_json()["data"]["name"] == "alice"


def test_session_is_idempotent_and_updates_email(app):
    with app.app_context():
        client = app.test_client()
        _, first = sso_login(client)
        status, second = sso_login(client, email="alice2@example.org")
        assert status == 200
        assert second["data"]["created"] is False
        assert second["data"]["user"]["id"] == first["data"]["user"]["id"]
        assert Users.query.filter_by(id=first["data"]["user"]["id"]).first().email == (
            "alice2@example.org"
        )


def test_admin_and_manager_mapping(app):
    with app.app_context():
        client = app.test_client()
        _, body = sso_login(client, sub="adm", email="adm@example.org",
                            username="adm", groups=["ctf-admins"])
        assert body["data"]["user"]["type"] == "admin"
        assert "admin" in body["data"]["user"]["roles"]

        _, body = sso_login(client, sub="mgr", email="mgr@example.org",
                            username="mgr", groups=["ctf-managers"])
        assert body["data"]["user"]["type"] == "user"
        assert body["data"]["user"]["roles"] == ["manager"]
        user = Users.query.filter_by(id=body["data"]["user"]["id"]).first()
        assert pad_roles.is_manager(user)
        assert user.hidden is True

        # Retrait du groupe admin : rétrogradation.
        _, body = sso_login(client, sub="adm", email="adm@example.org",
                            username="adm", groups=["ctf-players"])
        assert body["data"]["user"]["type"] == "user"


def test_demotion_revokes_previous_tokens(app):
    """Une rétrogradation prend effet tout de suite : l'ancien token (droits périmés) est révoqué."""
    with app.app_context():
        client = app.test_client()
        _, body = sso_login(client, sub="m1", email="m1@example.org",
                            username="m1", groups=["ctf-players", "ctf-managers"])
        old_token = body["data"]["token"]
        assert client.get("/api/v1/users/me",
                          headers=token_headers(old_token)).status_code == 200

        _, body = sso_login(client, sub="m1", email="m1@example.org",
                            username="m1", groups=["ctf-players"])
        assert body["data"]["user"]["roles"] == []
        assert client.get("/api/v1/users/me",
                          headers=token_headers(old_token)).status_code == 401
        new_token = body["data"]["token"]
        assert client.get("/api/v1/users/me",
                          headers=token_headers(new_token)).status_code == 200


def test_same_privileges_keep_previous_tokens(app):
    with app.app_context():
        client = app.test_client()
        _, body = sso_login(client)
        first = body["data"]["token"]
        sso_login(client)
        assert client.get("/api/v1/users/me",
                          headers=token_headers(first)).status_code == 200


def test_unlinked_account_is_never_taken_over_by_email(app):
    """Un sub inconnu avec l'e-mail d'un compte existant (ex. admin break-glass) est refusé."""
    with app.app_context():
        admin = Users(name="breakglass", email="root@example.org",
                      password="x" * 20, type="admin", verified=True)
        db.session.add(admin)
        db.session.commit()
        admin_id = admin.id

        client = app.test_client()
        status, _ = sso_login(client, sub="attacker", email="root@example.org",
                              username="evil", groups=["ctf-players"])
        assert status == 409

        again = Users.query.filter_by(id=admin_id).first()
        assert again.type == "admin"
        assert again.name == "breakglass"
        assert pad_roles.find_user_by_sub("attacker") is None
        assert pad_roles.OidcIdentity.query.filter_by(user_id=admin_id).first() is None


def test_explicit_admin_link_is_honoured(app):
    """Liaison explicite : un admin pose la ligne sub -> user_id avant la connexion."""
    with app.app_context():
        user = Users(name="pre", email="pre@example.org",
                     password="x" * 20, verified=True)
        db.session.add(user)
        db.session.commit()
        db.session.add(pad_roles.OidcIdentity(sub="sub-pre", user_id=user.id))
        db.session.commit()

        status, body = sso_login(app.test_client(), sub="sub-pre",
                                 email="pre@example.org", username="pre")
        assert status == 200
        assert body["data"]["user"]["id"] == user.id
        assert body["data"]["created"] is False


def test_no_ctf_group_is_forbidden(app):
    with app.app_context():
        status, _ = sso_login(app.test_client(), groups=["other"])
        assert status == 403


def test_username_collision_gets_suffix(app):
    with app.app_context():
        client = app.test_client()
        _, a = sso_login(client, sub="a", email="a@example.org", username="bob")
        _, b = sso_login(client, sub="b", email="b@example.org", username="bob")
        assert a["data"]["user"]["name"] == "bob"
        assert b["data"]["user"]["name"].startswith("bob-")


def test_bad_signature_rejected(app):
    with app.app_context():
        client = app.test_client()
        raw, headers = signed_headers({"sub": "x"}, secret="wrong")
        assert client.post("/api/v1/sso/session", data=raw,
                           headers=headers).status_code == 401


def test_body_tampering_rejected(app):
    with app.app_context():
        client = app.test_client()
        raw, headers = signed_headers(
            {"sub": "x", "email": "x@example.org", "groups": ["ctf-players"]}
        )
        tampered = raw.replace(b"ctf-players", b"ctf-admins_")
        assert client.post("/api/v1/sso/session", data=tampered,
                           headers=headers).status_code == 401


def test_stale_timestamp_rejected(app):
    with app.app_context():
        client = app.test_client()
        raw, headers = signed_headers(
            {"sub": "x", "email": "x@example.org", "groups": ["ctf-players"]},
            ts=int(time.time()) - 3600,
        )
        assert client.post("/api/v1/sso/session", data=raw,
                           headers=headers).status_code == 401


def test_replay_rejected(app):
    with app.app_context():
        client = app.test_client()
        raw, headers = signed_headers(
            {"sub": "x", "email": "x@example.org", "groups": ["ctf-players"]}
        )
        assert client.post("/api/v1/sso/session", data=raw,
                           headers=headers).status_code == 200
        assert client.post("/api/v1/sso/session", data=raw,
                           headers=headers).status_code == 401


def test_previous_secret_accepted_for_rotation(app):
    app.config["PAD_SSO_SHARED_SECRET_PREVIOUS"] = "old-secret-0123456789"
    with app.app_context():
        raw, headers = signed_headers(
            {"sub": "x", "email": "x@example.org", "groups": ["ctf-players"]},
            secret="old-secret-0123456789",
        )
        assert app.test_client().post("/api/v1/sso/session", data=raw,
                                      headers=headers).status_code == 200


def test_missing_secret_fails_closed(app):
    app.config["PAD_SSO_SHARED_SECRET"] = ""
    with app.app_context():
        raw, headers = signed_headers({"sub": "x"})
        assert app.test_client().post("/api/v1/sso/session", data=raw,
                                      headers=headers).status_code == 503


def test_source_cidr_filter(app):
    app.config["PAD_SSO_ALLOWED_CIDRS"] = "10.244.0.0/16"
    with app.app_context():
        status, _ = sso_login(app.test_client())
        assert status == 403  # le client de test vient de 127.0.0.1


def test_expired_token_rejected(app):
    app.config["PAD_SSO_TOKEN_TTL_SECONDS"] = "-1"
    with app.app_context():
        client = app.test_client()
        _, body = sso_login(client)
        me = client.get("/api/v1/users/me",
                        headers=token_headers(body["data"]["token"]))
        assert me.status_code == 401


def test_banned_user_cannot_get_token(app):
    with app.app_context():
        client = app.test_client()
        _, body = sso_login(client)
        user = Users.query.filter_by(id=body["data"]["user"]["id"]).first()
        user.banned = True
        from CTFd.models import db

        db.session.commit()
        status, _ = sso_login(client)
        assert status == 403


def test_local_auth_disabled(app):
    with app.app_context():
        client = app.test_client()
        assert client.get("/login").status_code == 404
        assert client.get("/register").status_code == 404
        assert client.get("/reset_password").status_code == 404
        assert client.get("/oauth").status_code == 404


def test_breakglass_login_admin_only(app):
    app.config["PAD_LOCAL_LOGIN_BREAKGLASS"] = "true"
    with app.app_context():
        client = app.test_client()
        assert client.get("/login").status_code == 200
        assert client.get("/register").status_code == 404
        # Un joueur SSO ne peut pas utiliser le break-glass.
        sso_login(client)
        with client.session_transaction() as sess:
            nonce = sess.get("nonce")
        resp = client.post("/login", data={"name": "alice", "password": "x",
                                           "nonce": nonce})
        assert resp.status_code == 403
        # L'admin créé par /setup peut se connecter.
        with client.session_transaction() as sess:
            nonce = sess.get("nonce")
        resp = client.post("/login", data={"name": "admin", "password": "password",
                                           "nonce": nonce})
        assert resp.status_code == 302


def test_breakglass_host_restriction(app):
    app.config["PAD_LOCAL_LOGIN_BREAKGLASS"] = "true"
    app.config["PAD_LOCAL_LOGIN_HOSTS"] = "ctfd-admin.example.net"
    with app.app_context():
        client = app.test_client()
        assert client.get("/login").status_code == 404
        assert client.get(
            "/login", headers={"Host": "ctfd-admin.example.net"}
        ).status_code in (200, 404)
