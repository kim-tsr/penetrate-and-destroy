import datetime
import io
import os
import pathlib
import time
import zipfile

import pytest
import yaml

from CTFd.models import (
    ChallengeFiles,
    Challenges,
    Flags,
    Hints,
    Solves,
    Tags,
    Users,
    db,
)
from CTFd.utils import get_config
from tests.helpers import gen_challenge, gen_fail, gen_solve, gen_user
from tests.pad.conftest import sso_login, token_headers
from tests.pad.fake_cm import FakeChallManager, install

IMPORT = "/api/v1/manager/challenges/import"


def _token(client, groups, sub="m1"):
    _, body = sso_login(client, sub=sub, email=f"{sub}@example.org",
                        username=sub, groups=groups)
    return body["data"]["token"]


def _manager(client):
    return _token(client, ["ctf-managers"], "mgr")


def _auth(token):
    return {"Authorization": f"Token {token}"}


def make_zip(spec, files=None, raw_yaml=None, prefix="", extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(prefix + "challenge.yml", raw_yaml or yaml.safe_dump(spec))
        for name, data in (files or {}).items():
            zf.writestr(prefix + name, data)
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return buf.getvalue()


def post_zip(client, token, blob):
    return client.post(
        IMPORT,
        data={"file": (io.BytesIO(blob), "chall.zip")},
        headers=_auth(token),
        content_type="multipart/form-data",
    )


BASE = {
    "name": "crackme",
    "category": "reverse",
    "description": "Find the flag",
    "value": 150,
    "flags": ["PAD{one}", {"type": "regex", "content": "PAD\\{r.*\\}", "data": "case_insensitive"}],
    "tags": ["easy", "elf"],
    "hints": ["look closer", {"content": "strings", "cost": 10}],
    "files": ["dist/crackme.bin"],
}


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


def test_requires_manager_role(app):
    with app.app_context():
        client = app.test_client()
        blob = make_zip(BASE, {"dist/crackme.bin": b"\x7fELF"})
        assert client.get("/api/v1/manager/challenges").status_code == 401
        assert client.post(IMPORT, data={"file": (io.BytesIO(blob), "c.zip")},
                           headers=_auth("ctfd_bad"),
                           content_type="multipart/form-data").status_code == 401
        player = _token(client, ["ctf-players"], "pl")
        for method, url in (("get", "/api/v1/manager/challenges"),
                            ("get", "/api/v1/manager/challenges/1/stats"),
                            ("patch", "/api/v1/manager/event")):
            resp = getattr(client, method)(url, headers=token_headers(player))
            assert resp.status_code == 403, url
            assert resp.get_json() is not None, (url, resp.data[:300])
            assert resp.get_json()["success"] is False
        assert post_zip(client, player, blob).status_code == 403
        # Un admin CTFd est accepté.
        # (client neuf : le cookie de session du joueur prime sur le token)
        client = app.test_client()
        admin = _token(client, ["ctf-admins"], "adm")
        client = app.test_client()
        assert client.get("/api/v1/manager/challenges",
                          headers=_auth(admin)).status_code == 200


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------


def test_import_creates_then_updates_idempotently(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        blob = make_zip(BASE, {"dist/crackme.bin": b"\x7fELF-v1"})
        resp = post_zip(client, token, blob)
        assert resp.status_code == 201, resp.get_json()
        data = resp.get_json()["data"]
        assert data["action"] == "created"
        assert data["files"] == ["crackme.bin"] and data["files_uploaded"] == ["crackme.bin"]
        cid = data["id"]

        chal = Challenges.query.filter_by(id=cid).first()
        assert chal.type == "standard" and chal.value == 150
        assert {f.type for f in Flags.query.filter_by(challenge_id=cid)} == {"static", "regex"}
        assert Hints.query.filter_by(challenge_id=cid, cost=10).count() == 1
        assert sorted(t.value for t in Tags.query.filter_by(challenge_id=cid)) == ["easy", "elf"]
        assert ChallengeFiles.query.filter_by(challenge_id=cid).count() == 1

        # Ré-import identique : mise à jour, mêmes lignes, fichier conservé.
        resp = post_zip(client, token, blob)
        assert resp.status_code == 200
        assert resp.get_json()["data"]["action"] == "updated"
        assert resp.get_json()["data"]["files_uploaded"] == []
        assert Challenges.query.filter_by(name="crackme").count() == 1
        assert Flags.query.filter_by(challenge_id=cid).count() == 2
        assert Tags.query.filter_by(challenge_id=cid).count() == 2
        assert ChallengeFiles.query.filter_by(challenge_id=cid).count() == 1

        # Modification : valeur, flags, fichier remplacé.
        changed = dict(BASE, value=300, flags=["PAD{two}"], tags=["hard"])
        resp = post_zip(client, token, make_zip(changed, {"dist/crackme.bin": b"v2"}))
        assert resp.status_code == 200
        assert resp.get_json()["data"]["files_uploaded"] == ["crackme.bin"]
        chal = Challenges.query.filter_by(id=cid).first()
        assert chal.value == 300
        assert [f.content for f in Flags.query.filter_by(challenge_id=cid)] == ["PAD{two}"]
        assert [t.value for t in Tags.query.filter_by(challenge_id=cid)] == ["hard"]
        assert ChallengeFiles.query.filter_by(challenge_id=cid).count() == 1


def test_import_accepts_single_root_folder_and_requirements(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        assert post_zip(client, token, make_zip(
            BASE, {"dist/crackme.bin": b"x"}, prefix="crackme/")).status_code == 201
        child = {"name": "crackme2", "category": "reverse", "description": "d",
                 "value": 50, "requirements": ["crackme"], "flags": ["a"]}
        resp = post_zip(client, token, make_zip(child, prefix="c2/"))
        assert resp.status_code == 201, resp.get_json()
        chal = Challenges.query.filter_by(name="crackme2").first()
        base = Challenges.query.filter_by(name="crackme").first()
        assert chal.requirements == {"prerequisites": [base.id]}
        bad = dict(child, name="crackme3", requirements=["nope"])
        assert post_zip(client, token, make_zip(bad)).status_code == 422


def test_import_dynamic_scoring(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        spec = {"name": "dyn", "category": "web", "description": "d", "type": "dynamic",
                "extra": {"initial": 500, "minimum": 100, "decay": 10}, "flags": ["f"]}
        resp = post_zip(client, token, make_zip(spec))
        assert resp.status_code == 201, resp.get_json()
        chal = Challenges.query.filter_by(name="dyn").first()
        assert chal.function == "logarithmic" and chal.value == 500
        spec["extra"] = {"initial": 500}
        assert post_zip(client, token, make_zip(spec)).status_code == 422


def test_import_instance_registers_scenario_in_chall_manager(app):
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        token = _manager(client)
        spec = {
            "name": "web-sqli", "category": "web", "description": "d", "value": 200,
            "flags": ["PAD{x}"],
            "instance": {"image": "registry.test/pad/web:1@sha256:" + "a" * 64,
                         "ports": [8080, {"port": 22, "protocol": "tcp"}], "ttl": 900,
                         "limits": {"cpu": "500m", "memory": "256Mi"}},
        }
        resp = post_zip(client, token, make_zip(spec))
        assert resp.status_code == 201, resp.get_json()
        data = resp.get_json()["data"]
        assert data["type"] == "dynamic_instance" and data["instance"] is True
        cid = str(data["id"])
        remote = fake.challenges[cid]
        assert remote["scenario"] == app.config["PAD_GENERIC_SCENARIO"]
        assert remote["timeout"] == "900s"
        assert remote["additional"]["ports"] == "8080/tcp,22/tcp"
        assert remote["additional"]["limits_memory"] == "256Mi"

        # Idempotent : second import = PATCH chall-manager, pas de doublon.
        spec["instance"]["ttl"] = 1200
        resp = post_zip(client, token, make_zip(spec))
        assert resp.status_code == 200
        assert fake.challenges[cid]["timeout"] == "1200s"
        assert Challenges.query.filter_by(name="web-sqli").count() == 1

        # Le type ne peut pas changer silencieusement.
        plain = {k: v for k, v in spec.items() if k != "instance"}
        assert post_zip(client, token, make_zip(plain)).status_code == 409


def test_import_instance_chall_manager_down_leaves_nothing(app):
    fake = FakeChallManager(down=True)
    with app.app_context(), install(fake):
        client = app.test_client()
        token = _manager(client)
        spec = {"name": "x", "category": "web", "description": "d", "value": 1,
                "flags": ["f"],
                "instance": {"image": "registry.test/pad/x:1", "ports": [80]}}
        assert post_zip(client, token, make_zip(spec)).status_code == 502
        assert Challenges.query.filter_by(name="x").count() == 0


def test_import_validation_errors(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        # Champ obligatoire manquant.
        resp = post_zip(client, token, make_zip({"name": "a"}))
        assert resp.status_code == 422
        assert resp.get_json()["errors"]["challenge.yml"]
        # Port invalide / champ instance inconnu.
        spec = {"name": "a", "category": "c", "description": "d", "value": 1,
                "flags": ["f"],
                "instance": {"image": "registry.test/pad/x:1", "ports": [70000]}}
        assert post_zip(client, token, make_zip(spec)).status_code == 422
        spec["instance"] = {"image": "registry.test/pad/x:1", "ports": [80], "privileged": True}
        assert post_zip(client, token, make_zip(spec)).status_code == 422
        # YAML cassé, racine non-mapping, valeur statique absente.
        assert post_zip(client, token, make_zip(None, raw_yaml="a: [")).status_code == 422
        assert post_zip(client, token, make_zip(None, raw_yaml="- 1")).status_code == 422
        nov = {"name": "a", "category": "c", "description": "d", "flags": ["f"]}
        assert post_zip(client, token, make_zip(nov)).status_code == 422
        # Fichier listé absent.
        miss = dict(nov, value=1, files=["nope.bin"])
        assert post_zip(client, token, make_zip(miss)).status_code == 422
        assert Challenges.query.count() == 0
        # Pas de fichier / pas un zip / pas de challenge.yml.
        assert client.post(IMPORT, data={}, headers=_auth(token),
                           content_type="multipart/form-data").status_code == 400
        assert post_zip(client, token, b"not a zip").status_code == 400
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", "x")
        assert post_zip(client, token, buf.getvalue()).status_code == 422


def test_import_blocks_zip_slip_symlink_and_bombs(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        spec = {"name": "a", "category": "c", "description": "d", "value": 1, "flags": ["f"]}

        for evil in ("../evil.txt", "/etc/passwd", "a/../../x", "..\\x", "C:/x"):
            blob = make_zip(spec, extra={evil: b"x"})
            assert post_zip(client, token, blob).status_code == 422, evil

        # Chemin d'un fichier listé qui sort de l'archive.
        listed = dict(spec, files=["../secret"])
        assert post_zip(client, token, make_zip(listed)).status_code == 422

        # Lien symbolique.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("challenge.yml", yaml.safe_dump(spec))
            link = zipfile.ZipInfo("link")
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            zf.writestr(link, "/etc/passwd")
        assert post_zip(client, token, buf.getvalue()).status_code == 422

        # Zip bomb : ratio énorme / taille décompressée au-delà de la limite.
        app.config["PAD_IMPORT_MAX_FILE_BYTES"] = 1024 * 1024
        bomb = make_zip(spec, {"big.bin": b"\0" * (8 * 1024 * 1024)})
        assert post_zip(client, token, bomb).status_code == 413
        app.config["PAD_IMPORT_MAX_FILE_BYTES"] = 100 * 1024 * 1024
        assert post_zip(client, token, bomb).status_code == 413  # ratio

        # Trop d'entrées, archive trop grosse.
        app.config["PAD_IMPORT_MAX_ENTRIES"] = 3
        many = make_zip(spec, {f"f{i}": b"x" for i in range(5)})
        assert post_zip(client, token, many).status_code == 413
        app.config["PAD_IMPORT_MAX_ENTRIES"] = 200
        app.config["PAD_IMPORT_MAX_ZIP_BYTES"] = 100
        assert post_zip(client, token, make_zip(spec)).status_code == 413
        assert Challenges.query.count() == 0


# --------------------------------------------------------------------------
# Liste et stats
# --------------------------------------------------------------------------


def _seed():
    c1 = gen_challenge(db, name="c1", category="web", value=100)
    c2 = gen_challenge(db, name="c2", category="pwn", value=200, state="hidden")
    users = [gen_user(db, name=f"u{i}", email=f"u{i}@x.org") for i in range(3)]
    now = datetime.datetime.utcnow()
    for user, hours in ((users[0], 3), (users[1], 1)):
        solve = gen_solve(db, user_id=user.id, challenge_id=c1.id)
        solve.date = now - datetime.timedelta(hours=hours)
        db.session.commit()
    gen_fail(db, user_id=users[2].id, challenge_id=c1.id)
    gen_fail(db, user_id=users[2].id, challenge_id=c1.id)
    # Compte caché : ignoré des stats.
    ghost = gen_user(db, name="ghost", email="g@x.org", hidden=True)
    solve = gen_solve(db, user_id=ghost.id, challenge_id=c1.id)
    solve.date = now - datetime.timedelta(hours=10)
    db.session.commit()
    return c1, c2, users


def test_list_and_stats(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        c1, c2, users = _seed()

        resp = client.get("/api/v1/manager/challenges", headers=_auth(token))
        assert resp.status_code == 200
        body = resp.get_json()
        rows = {r["name"]: r for r in body["data"]}
        assert body["meta"]["count"] == 2
        assert rows["c1"]["solves"] == 2 and rows["c1"]["attempts"] == 4
        assert rows["c1"]["success_rate"] == 0.5
        assert rows["c2"]["state"] == "hidden" and rows["c2"]["solves"] == 0
        assert rows["c2"]["success_rate"] == 0.0
        assert body["meta"]["solves"] == 2

        resp = client.get(f"/api/v1/manager/challenges/{c1.id}/stats",
                          headers=_auth(token))
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["solves"] == 2 and data["incorrect_attempts"] == 2
        assert data["first_blood"]["user_name"] == "u0"
        assert [p["cumulative"] for p in data["solves_over_time"]] == [1, 2]
        assert data["bucket"] == "hour"

        day = client.get(f"/api/v1/manager/challenges/{c1.id}/stats?bucket=day",
                         headers=_auth(token)).get_json()["data"]
        assert day["solves_over_time"][-1]["cumulative"] == 2
        assert client.get(f"/api/v1/manager/challenges/{c1.id}/stats?bucket=week",
                          headers=_auth(token)).status_code == 400
        assert client.get("/api/v1/manager/challenges/9999/stats",
                          headers=_auth(token)).status_code == 404

        empty = client.get(f"/api/v1/manager/challenges/{c2.id}/stats",
                           headers=_auth(token)).get_json()["data"]
        assert empty["first_blood"] is None and empty["solves_over_time"] == []
        assert Solves.query.count() == 3 and Users.query.count() >= 4


# --------------------------------------------------------------------------
# Événement
# --------------------------------------------------------------------------


def test_event_patch(app):
    with app.app_context():
        client = app.test_client()
        token = _manager(client)
        h = token_headers(token)
        now = int(time.time())
        resp = client.patch("/api/v1/manager/event", headers=h, json={
            "start": now - 100, "end": now + 1000,
            "freeze": (datetime.datetime.utcfromtimestamp(now + 500).isoformat() + "Z"),
        })
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()["data"]
        assert data["start"] == now - 100 and data["end"] == now + 1000
        assert data["freeze"] == now + 500 and data["state"] == "running"
        assert int(get_config("end")) == now + 1000

        resp = client.patch("/api/v1/manager/event", headers=h, json={"paused": True})
        assert resp.get_json()["data"]["state"] == "paused"
        assert client.get("/api/v1/manager/event", headers=h).get_json()["data"]["paused"]

        # Incohérences et champs invalides.
        assert client.patch("/api/v1/manager/event", headers=h,
                            json={"start": now + 2000}).status_code == 422
        assert client.patch("/api/v1/manager/event", headers=h,
                            json={"freeze": now + 5000}).status_code == 422
        assert client.patch("/api/v1/manager/event", headers=h,
                            json={"start": "demain"}).status_code == 400
        assert client.patch("/api/v1/manager/event", headers=h,
                            json={"foo": 1}).status_code == 400
        assert client.patch("/api/v1/manager/event", headers=h,
                            json={}).status_code == 400

        # null efface la valeur.
        resp = client.patch("/api/v1/manager/event", headers=h,
                            json={"freeze": None, "end": None, "paused": False})
        data = resp.get_json()["data"]
        assert data["freeze"] is None and data["end"] is None
        assert data["state"] == "running"


# --------------------------------------------------------------------------
# Exemples du repo (challenges/*/challenge.yml) : schéma unique + import
# --------------------------------------------------------------------------

REPO_CHALLENGES = pathlib.Path(os.environ["PAD_CHALLENGE_SCHEMA"]).resolve().parents[1]
EXAMPLES = sorted(p.parent for p in REPO_CHALLENGES.glob("*/challenge.yml"))


def _zip_dir(root):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if path.is_file() and "app" not in rel.parts[:1]:
                zf.write(path, rel.as_posix())
    return buf.getvalue()


def test_examples_are_found():
    assert len(EXAMPLES) == 3


@pytest.mark.parametrize("root", EXAMPLES, ids=lambda p: p.name)
def test_import_repo_example(app, root):
    spec = yaml.safe_load((root / "challenge.yml").read_text(encoding="utf-8"))
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        token = _manager(client)
        resp = post_zip(client, token, _zip_dir(root))
        assert resp.status_code == 201, resp.get_json()
        data = resp.get_json()["data"]
        chal = Challenges.query.filter_by(id=data["id"]).first()
        assert chal.name == spec["name"] and chal.state == "hidden"
        assert chal.type == ("dynamic_instance" if "instance" in spec else "standard")
        assert data["instance"] is ("instance" in spec)
        assert Flags.query.filter_by(challenge_id=chal.id).count() == len(spec["flags"])
        if spec.get("type") == "dynamic":
            extra = spec["extra"]
            assert chal.function == extra["function"]
            assert (chal.initial, chal.minimum, chal.decay) == (
                extra["initial"], extra["minimum"], extra["decay"])
        else:
            assert chal.value == spec["value"]
        assert data["files"] == [os.path.basename(f) for f in spec.get("files", [])]
        if "instance" in spec:
            remote = fake.challenges[str(chal.id)]
            ports = ",".join(f"{p['port']}/{p.get('protocol', 'tcp')}"
                             for p in spec["instance"]["ports"])
            assert remote["additional"]["ports"] == ports
            assert remote["additional"]["image"] == spec["instance"]["image"]
        assert post_zip(client, token, _zip_dir(root)).status_code == 200


def test_import_dynamic_with_instance_keeps_decay(app):
    fake = FakeChallManager()
    with app.app_context(), install(fake):
        client = app.test_client()
        token = _manager(client)
        spec = {"name": "dyn-inst", "category": "web", "description": "d",
                "type": "dynamic", "flags": ["f"],
                "extra": {"initial": 400, "minimum": 100, "decay": 10,
                          "function": "linear"},
                "instance": {"image": "registry.test/pad/x:1", "ports": [80],
                             "ttl": "30m"}}
        resp = post_zip(client, token, make_zip(spec))
        assert resp.status_code == 201, resp.get_json()
        chal = Challenges.query.filter_by(name="dyn-inst").first()
        assert chal.type == "dynamic_instance" and chal.function == "linear"
        assert chal.initial == 400 and chal.timeout == 1800
