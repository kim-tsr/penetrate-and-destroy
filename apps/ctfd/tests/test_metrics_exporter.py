import re

from CTFd.models import Challenges, Fails, Solves, db
from CTFd.utils import set_config
from tests.pad.conftest import sso_login, token_headers

AUTH = {"Authorization": "Bearer metrics-token"}


def _value(text, name, **labels):
    for line in text.splitlines():
        if not line.startswith(name):
            continue
        if all(f'{k}="{v}"' in line for k, v in labels.items()):
            return float(line.rsplit(" ", 1)[1])
    raise AssertionError(f"{name} {labels} absent")


def test_metrics_requires_token(app):
    with app.app_context():
        client = app.test_client()
        assert client.get("/metrics").status_code == 401
        assert client.get("/metrics", headers={"Authorization": "Bearer nope"}
                          ).status_code == 401


def test_metrics_fail_closed_without_token(app):
    app.config["PAD_METRICS_TOKEN"] = ""
    with app.app_context():
        assert app.test_client().get("/metrics", headers=AUTH).status_code == 503


def test_metrics_content(app):
    app.config["PAD_METRICS_CACHE_SECONDS"] = "0"
    with app.app_context():
        client = app.test_client()
        _, alice = sso_login(client, sub="a", email="a@example.org", username="alice")
        _, bob = sso_login(client, sub="b", email="b@example.org", username="bob")
        # Une requête authentifiée alimente l'activité.
        client.get("/api/v1/users/me", headers=token_headers(alice["data"]["token"]))

        chal = Challenges(name='quote"chal', category="web", value=100,
                          state="visible", type="standard")
        db.session.add(chal)
        db.session.commit()
        a_id, b_id = alice["data"]["user"]["id"], bob["data"]["user"]["id"]
        db.session.add(Solves(user_id=a_id, challenge_id=chal.id, ip="1.1.1.1",
                              provided="f"))
        db.session.add(Fails(user_id=b_id, challenge_id=chal.id, ip="1.1.1.2",
                             provided="x"))
        db.session.add(Solves(user_id=b_id, challenge_id=chal.id, ip="1.1.1.2",
                              provided="f"))
        db.session.commit()
        set_config("paused", True)

        resp = client.get("/metrics", headers=AUTH)
        assert resp.status_code == 200
        assert resp.mimetype == "text/plain"
        text = resp.get_data(as_text=True)

        assert _value(text, "ctfd_users", kind="all") == 3  # admin setup + 2
        assert _value(text, "ctfd_active_users", window="5m") >= 1
        assert _value(text, "ctfd_challenge_solves", challenge_id=chal.id) == 2
        assert _value(text, "ctfd_submissions_total", result="correct") == 2
        assert _value(text, "ctfd_submissions_total", result="incorrect") == 1
        assert _value(text, "ctfd_challenge_first_blood_timestamp_seconds",
                      account="alice") > 0
        assert _value(text, "ctfd_event_state", state="paused") == 1
        assert _value(text, "ctfd_event_state", state="running") == 0
        assert _value(text, "pad_instances_active") == 0
        # Échappement des guillemets dans les labels.
        assert 'challenge="quote\\"chal"' in text
        # Format : chaque métrique a HELP et TYPE.
        names = set(re.findall(r"^# TYPE (\S+)", text, re.M))
        assert {"ctfd_users", "ctfd_event_state", "ctfd_submissions_total"} <= names
