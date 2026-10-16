"""sso_bridge : provisionnement OIDC et tokens API courts pour le BFF Next.js.

Endpoint : POST /api/v1/sso/session (voir apps/ctfd/API.md).

Sécurité en profondeur :
1. NetworkPolicy : seul le namespace `frontend` (et l'ingress interne
   ctfd-admin, qui ne route pas /api/v1/sso) atteint CTFd ;
2. HMAC-SHA256 du BFF sur (timestamp, nonce, méthode, chemin, sha256(corps)) ;
3. fenêtre temporelle de ±PAD_SSO_MAX_SKEW_SECONDS et nonce à usage unique ;
4. option PAD_SSO_ALLOWED_CIDRS : filtrage applicatif de l'IP source.

Il désactive aussi l'authentification locale de CTFd (login, inscription,
reset, OAuth MLC). Break-glass : PAD_LOCAL_LOGIN_BREAKGLASS=true rouvre
/login aux seuls comptes admin, éventuellement limité aux hôtes listés dans
PAD_LOCAL_LOGIN_HOSTS (ex. ctfd-admin.<domaine>).
"""

import datetime
import ipaddress
import os
import re

from flask import Blueprint, abort, jsonify, request

from CTFd.models import Teams, Users, UserTokens, db
from CTFd.plugins import bypass_csrf_protection
from CTFd.plugins.pad_common import roles as pad_roles
from CTFd.plugins.pad_common.auth import verify_hmac_request
from CTFd.plugins.pad_common.settings import (
    setting,
    setting_bool,
    setting_int,
    setting_list,
)
from CTFd.utils.security.auth import generate_user_token
from CTFd.utils.validators import validate_email

TOKEN_DESCRIPTION = "pad-sso"
NAME_RE = re.compile(r"[^A-Za-z0-9._\- ]+")

# Endpoints Flask de l'authentification locale de CTFd.
LOCAL_AUTH_ENDPOINTS = {
    "auth.register",
    "auth.login",
    "auth.reset_password",
    "auth.confirm",
    "auth.oauth_login",
    "auth.oauth_redirect",
}

sso = Blueprint("pad_sso_bridge", __name__)


def _group_names():
    return {
        "admin": setting("PAD_GROUP_ADMINS", "ctf-admins"),
        "manager": setting("PAD_GROUP_MANAGERS", "ctf-managers"),
        "player": setting("PAD_GROUP_PLAYERS", "ctf-players"),
    }


def _bad_request(message):
    resp = jsonify({"success": False, "errors": {"_": [message]}})
    resp.status_code = 400
    return resp


def _check_source_ip():
    cidrs = setting_list("PAD_SSO_ALLOWED_CIDRS")
    if not cidrs:
        return
    try:
        # remote_addr direct : l'appel BFF -> CTFd ne passe pas par un proxy.
        addr = ipaddress.ip_address(request.environ.get("REMOTE_ADDR", ""))
    except ValueError:
        abort(403, description="Source not allowed")
    for cidr in cidrs:
        if addr in ipaddress.ip_network(cidr, strict=False):
            return
    abort(403, description="Source not allowed")


def _unique_name(base, exclude_user_id=None):
    base = NAME_RE.sub("", base or "").strip()[:100] or "player"
    candidate = base
    while True:
        existing = Users.query.filter_by(name=candidate).first()
        if existing is None or existing.id == exclude_user_id:
            return candidate
        candidate = f"{base}-{os.urandom(2).hex()}"


def _parse_claims(data):
    if not isinstance(data, dict):
        return None, "JSON object expected"
    sub = data.get("sub")
    email = (data.get("email") or "").strip().lower()
    username = (data.get("preferred_username") or "").strip()
    groups = data.get("groups") or []
    if not isinstance(sub, str) or not sub or len(sub) > 255:
        return None, "Invalid 'sub'"
    if not email or len(email) > 128 or validate_email(email) is not True:
        return None, "Invalid 'email'"
    if not isinstance(groups, list) or not all(isinstance(g, str) for g in groups):
        return None, "Invalid 'groups'"
    if not username:
        username = email.split("@", 1)[0]
    return {"sub": sub, "email": email, "username": username, "groups": groups}, None


def _desired_roles(groups):
    names = _group_names()
    roles = set()
    if names["admin"] in groups:
        roles.add(pad_roles.ROLE_ADMIN)
    if names["manager"] in groups:
        roles.add(pad_roles.ROLE_MANAGER)
    is_player = names["player"] in groups
    return roles, is_player


def provision_user(claims):
    """Crée ou met à jour l'utilisateur CTFd. Retourne (user, created)."""
    roles, is_player = _desired_roles(claims["groups"])
    if not roles and not is_player:
        abort(403, description="No CTF group in claims")

    created = False
    user = pad_roles.find_user_by_sub(claims["sub"])
    if user is None:
        # Aucune liaison automatique par e-mail : l'e-mail n'est ni unique ni
        # vérifié côté IdP, et un `sub` inconnu ne doit jamais reprendre (ni
        # rétrograder) un compte existant, en particulier l'admin break-glass.
        # Une liaison est explicite : un admin pose la ligne `pad_oidc_identities`
        # (sub -> user_id) avant la première connexion.
        if Users.query.filter_by(email=claims["email"]).first() is not None:
            abort(409, description="Email already used by another account")
    if user is None:
        user = Users(
            name=_unique_name(claims["username"]),
            email=claims["email"],
            # Mot de passe aléatoire (haché par le modèle) jamais communiqué :
            # aucun login local possible pour les comptes SSO.
            password=os.urandom(32).hex(),
            verified=True,
        )
        db.session.add(user)
        db.session.flush()
        created = True
    else:
        if user.email != claims["email"]:
            taken = Users.query.filter_by(email=claims["email"]).first()
            if taken is None or taken.id == user.id:
                user.email = claims["email"]
        user.verified = True

    if user.banned:
        db.session.rollback()
        abort(403, description="You have been banned from this CTF")

    # Privilèges avant mise à jour : sert à révoquer les tokens en cas de rétrogradation.
    privileges_before = set(pad_roles.get_roles(user)) & {
        pad_roles.ROLE_ADMIN,
        pad_roles.ROLE_MANAGER,
    }

    if pad_roles.ROLE_MANAGER in roles and setting_bool("PAD_HIDE_MANAGERS", True):
        user.hidden = True
    pad_roles.set_sub(user, claims["sub"])
    pad_roles.set_roles(user, roles - {pad_roles.ROLE_ADMIN})
    db.session.commit()

    # `type` est la colonne polymorphe (Users/Admins) : on la modifie par
    # requête puis on recharge l'objet sous sa nouvelle classe.
    wanted = "admin" if pad_roles.ROLE_ADMIN in roles else "user"
    user_id = user.id
    if user.type != wanted:
        Users.query.filter_by(id=user_id).update(
            {"type": wanted}, synchronize_session=False
        )
        db.session.commit()
        db.session.expunge(user)
        user = Users.query.filter_by(id=user_id).first()
    # Rétrogradation (admin ou manager perdu) : les tokens SSO déjà émis portent
    # les anciens droits jusqu'à leur échéance, on les révoque tout de suite.
    if privileges_before - roles:
        UserTokens.query.filter(
            UserTokens.user_id == user_id,
            UserTokens.description == TOKEN_DESCRIPTION,
        ).delete(synchronize_session=False)
        db.session.commit()
    return user, created


def issue_token(user):
    ttl = setting_int("PAD_SSO_TOKEN_TTL_SECONDS", 300)
    now = datetime.datetime.utcnow()
    # Ménage : tokens SSO expirés de cet utilisateur.
    UserTokens.query.filter(
        UserTokens.user_id == user.id,
        UserTokens.description == TOKEN_DESCRIPTION,
        UserTokens.expiration < now,
    ).delete(synchronize_session=False)
    db.session.commit()
    expiration = now + datetime.timedelta(seconds=ttl)
    token = generate_user_token(user, expiration=expiration,
                                description=TOKEN_DESCRIPTION)
    return token, ttl


@sso.route("/api/v1/sso/session", methods=["POST"])
@bypass_csrf_protection
def create_session():
    _check_source_ip()
    verify_hmac_request()
    claims, error = _parse_claims(request.get_json(silent=True))
    if error:
        return _bad_request(error)

    user, created = provision_user(claims)
    token, ttl = issue_token(user)
    team = Teams.query.filter_by(id=user.team_id).first() if user.team_id else None
    return jsonify(
        {
            "success": True,
            "data": {
                "token": token.value,
                "token_id": token.id,
                "expires_at": token.expiration.replace(microsecond=0).isoformat()
                + "Z",
                "ttl": ttl,
                "created": created,
                "user": {
                    "id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "type": user.type,
                    "roles": pad_roles.get_roles(user),
                    "team_id": user.team_id,
                    "team_name": team.name if team else None,
                },
            },
        }
    )


def _local_auth_guard():
    if request.endpoint not in LOCAL_AUTH_ENDPOINTS:
        return None
    if request.endpoint == "auth.login" and setting_bool(
        "PAD_LOCAL_LOGIN_BREAKGLASS", False
    ):
        hosts = setting_list("PAD_LOCAL_LOGIN_HOSTS")
        if hosts and request.host.split(":")[0] not in hosts:
            abort(404)
        if request.method == "POST":
            name = (request.form.get("name") or "").strip()
            user = Users.query.filter(
                (Users.name == name) | (Users.email == name)
            ).first()
            preset = setting("PRESET_ADMIN_NAME")
            preset_email = setting("PRESET_ADMIN_EMAIL")
            is_preset = name and name in (preset, preset_email)
            if not is_preset and (user is None or user.type != "admin"):
                abort(403, description="Break-glass login is restricted to admins")
        return None
    abort(404)


def load(app):
    with app.app_context():
        db.create_all()
        pad_roles.ensure_fields()
    app.register_blueprint(sso)
    app.before_request(_local_auth_guard)
