"""Contrat d'authentification documenté dans API.md, section 1.

Deux dépendances de comportement de CTFd 3.8 sur lesquelles repose le BFF :

1. l'API native (`/api/v1/users/me`, `/api/v1/challenges`...) ne connecte
   l'utilisateur d'un header `Authorization: Token` que si la requête porte
   `Content-Type: application/json`, même pour un GET sans corps ;
2. les fichiers de challenge sont servis par `/files/<hash>/<nom>?token=...`,
   un jeton signé (1 h) lié au joueur, que seul `GET /api/v1/challenges/<id>`
   (appelé avec le token API du joueur) fournit.
"""

import io

from werkzeug.datastructures import FileStorage

from CTFd.models import db
from CTFd.utils import set_config
from CTFd.utils.uploads import upload_file
from tests.helpers import gen_challenge
from tests.pad.conftest import sso_login, token_headers


def _token(app, sub="pl", groups=("ctf-players",)):
    _, body = sso_login(app.test_client(), sub=sub, email=f"{sub}@example.org",
                        username=sub, groups=groups)
    return body["data"]["token"]


def test_native_api_ignores_token_without_json_content_type(app):
    with app.app_context():
        token = _token(app)
        bare = {"Authorization": f"Token {token}", "Accept": "application/json"}
        # Non authentifié : redirection vers /login (302) ou refus, jamais 200.
        assert app.test_client().get("/api/v1/users/me", headers=bare).status_code in (302, 403)
        resp = app.test_client().get("/api/v1/users/me", headers=token_headers(token))
        assert resp.status_code == 200
        assert resp.get_json()["data"]["name"] == "pl"


def test_pad_endpoints_accept_token_without_content_type(app):
    """Nos endpoints complètent le comportement natif (`ensure_token_login`)."""
    with app.app_context():
        token = _token(app)
        bare = {"Authorization": f"Token {token}"}
        assert app.test_client().get("/api/v1/pad/event", headers=bare).status_code == 200


def test_challenge_file_url_carries_a_user_token(app):
    with app.app_context():
        set_config("challenge_visibility", "private")
        token = _token(app)
        chal = gen_challenge(db, name="c1")
        upload_file(
            file=FileStorage(stream=io.BytesIO(b"payload"), filename="a.bin"),
            challenge_id=chal.id,
            type="challenge",
        )
        resp = app.test_client().get(f"/api/v1/challenges/{chal.id}",
                                     headers=token_headers(token))
        assert resp.status_code == 200
        files = resp.get_json()["data"]["files"]
        assert len(files) == 1 and files[0].startswith("/files/")
        path, _, query = files[0].partition("?")
        assert query.startswith("token=") and path.endswith("/a.bin")

        # Sans cookie ni header : le jeton de l'URL suffit (téléchargement par le BFF).
        anonymous = app.test_client()
        ok = anonymous.get(files[0])
        assert ok.status_code == 200 and ok.data == b"payload"
        # Sans jeton, ou avec un jeton falsifié : refusé.
        assert anonymous.get(path).status_code == 403
        assert anonymous.get(path + "?token=forge").status_code == 403
        assert anonymous.get(path + "?token=" + query[6:-2] + "xx").status_code == 403
