"""Fixtures communes : application CTFd avec plugins pad_* chargés."""

import json
import time
import uuid

import pytest

from CTFd.plugins.pad_common.auth import sign
from tests.helpers import create_ctfd, destroy_ctfd

SECRET = "test-shared-secret-0123456789abcdef"

PAD_CONFIG = {
    "PAD_SSO_SHARED_SECRET": SECRET,
    "PAD_METRICS_TOKEN": "metrics-token",
    "PAD_INTERNAL_TOKEN": "internal-token",
    "PAD_CHALL_MANAGER_URL": "http://chall-manager.test:8080",
    "PAD_GENERIC_SCENARIO": "registry.test/pad/scenarios/k8s-instance:v1@sha256:"
    + "0" * 64,
}


def make_app(user_mode="users", **extra):
    app = create_ctfd(enable_plugins=True, user_mode=user_mode)
    app.config.update(PAD_CONFIG)
    app.config.update(extra)
    return app


@pytest.fixture
def app():
    app = make_app()
    yield app
    destroy_ctfd(app)


@pytest.fixture
def teams_app():
    app = make_app(user_mode="teams")
    yield app
    destroy_ctfd(app)


def signed_headers(body, path="/api/v1/sso/session", method="POST",
                   secret=SECRET, ts=None, nonce=None):
    ts = int(time.time()) if ts is None else ts
    nonce = nonce or uuid.uuid4().hex
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return raw, {
        "Content-Type": "application/json",
        "X-PAD-Timestamp": str(ts),
        "X-PAD-Nonce": nonce,
        "X-PAD-Signature": sign(secret, ts, nonce, method, path, raw),
    }


def sso_login(client, sub="sub-1", email="alice@example.org",
              username="alice", groups=("ctf-players",)):
    """Appelle le sso_bridge et retourne (status, data)."""
    raw, headers = signed_headers(
        {
            "sub": sub,
            "email": email,
            "preferred_username": username,
            "groups": list(groups),
        }
    )
    resp = client.post("/api/v1/sso/session", data=raw, headers=headers)
    return resp.status_code, resp.get_json()


def token_headers(token):
    return {"Authorization": f"Token {token}", "Content-Type": "application/json"}
