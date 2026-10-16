"""Authentification des endpoints pad_* : token API CTFd et HMAC du BFF.

Token API : CTFd ne connecte l'utilisateur d'un header `Authorization: Token`
que si la requête est en JSON (ou un upload sur /api/v1/files). Les GET/DELETE
sans corps et les uploads multipart du portail manager n'en bénéficient donc
pas : `ensure_token_login()` complète ce comportement pour nos endpoints.

HMAC (sso_bridge) : voir `verify_hmac_request()`.
"""

import functools
import hashlib
import hmac
import time

from flask import abort, request, session

from CTFd.cache import cache
from CTFd.utils.security.auth import login_user
from CTFd.utils.user import authed, get_current_user

from .settings import setting, setting_int

HMAC_HEADER_TS = "X-PAD-Timestamp"
HMAC_HEADER_NONCE = "X-PAD-Nonce"
HMAC_HEADER_SIG = "X-PAD-Signature"


def ensure_token_login():
    """Connecte l'utilisateur porteur d'un token API CTFd si besoin.

    Retourne l'utilisateur courant ou None.
    """
    if authed():
        return get_current_user()
    header = request.headers.get("Authorization", "")
    if not header:
        return None
    # Import tardif : évite un import circulaire au chargement des plugins.
    from CTFd.exceptions import UserNotFoundException, UserTokenExpiredException
    from CTFd.utils.security.auth import lookup_user_token

    try:
        scheme, value = header.split(" ", 1)
    except ValueError:
        abort(401, description="Invalid authorization header")
    if scheme.lower() != "token":
        abort(401, description="Invalid authorization header")
    try:
        user = lookup_user_token(value.strip())
    except UserNotFoundException:
        abort(401, description="Your access token is invalid")
    except UserTokenExpiredException:
        abort(401, description="Your access token has expired")
    if user.banned:
        abort(403, description="You have been banned from this CTF")
    if user.team and user.team.banned:
        abort(403, description="Your team has been banned from this CTF")
    login_user(user)
    return user


def token_authed(f):
    """Décorateur : exige un utilisateur connecté (session ou token API)."""

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        user = ensure_token_login()
        if user is None or not session.get("id"):
            abort(401, description="Authentication required")
        return f(*args, **kwargs)

    return wrapper


def body_digest(raw):
    return hashlib.sha256(raw or b"").hexdigest()


def canonical_string(timestamp, nonce, method, path, raw_body):
    """Chaîne signée : `<ts>\\n<nonce>\\n<METHOD>\\n<path>\\n<sha256(body)>`."""
    return "\n".join(
        [str(timestamp), nonce, method.upper(), path, body_digest(raw_body)]
    )


def sign(secret, timestamp, nonce, method, path, raw_body):
    msg = canonical_string(timestamp, nonce, method, path, raw_body)
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()


def _secrets():
    """Secret courant + secret précédent (rotation sans coupure)."""
    out = []
    for name in ("PAD_SSO_SHARED_SECRET", "PAD_SSO_SHARED_SECRET_PREVIOUS"):
        value = setting(name)
        if value:
            out.append(value)
    return out


def verify_hmac_request():
    """Vérifie signature, fraîcheur et unicité (anti-rejeu) d'une requête.

    Lève 401 en cas d'échec, sans détailler la cause au client.
    """
    secrets = _secrets()
    if not secrets:
        # Fail closed : pas de secret configuré = endpoint inutilisable.
        abort(503, description="SSO bridge not configured")

    ts_raw = request.headers.get(HMAC_HEADER_TS, "")
    nonce = request.headers.get(HMAC_HEADER_NONCE, "")
    signature = request.headers.get(HMAC_HEADER_SIG, "")
    if not ts_raw or not nonce or not signature:
        abort(401, description="Missing signature headers")
    if not (16 <= len(nonce) <= 128) or not nonce.isascii():
        abort(401, description="Invalid nonce")
    try:
        ts = int(ts_raw)
    except ValueError:
        abort(401, description="Invalid timestamp")

    window = setting_int("PAD_SSO_MAX_SKEW_SECONDS", 60)
    if abs(time.time() - ts) > window:
        abort(401, description="Stale request")

    raw = request.get_data(cache=True)
    valid = False
    for secret in secrets:
        expected = sign(secret, ts, nonce, request.method, request.path, raw)
        if hmac.compare_digest(expected, signature.lower()):
            valid = True
    if not valid:
        abort(401, description="Invalid signature")

    # Anti-rejeu : le nonce est mémorisé (Valkey en prod) pendant 2x la fenêtre.
    # cache.add est atomique sur Redis/Valkey (SET NX).
    key = f"pad:sso:nonce:{hashlib.sha256(nonce.encode()).hexdigest()}"
    if not cache.add(key, 1, timeout=2 * window + 1):
        abort(401, description="Replayed request")
