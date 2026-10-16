"""Rôles PAD (champ utilisateur CTFd caché) et identité OIDC (table dédiée).

- `pad_roles` : `UserField` caché (public=False, editable=False) contenant la
  liste JSON des rôles applicatifs (`manager`, `admin`) ;
- le `sub` OIDC est dans la table indexée `pad_oidc_identities`
  (Users.oauth_id est un entier, inutilisable pour un sub Authentik).

Le type admin CTFd reste la source de vérité pour `ctf-admins`. Le rôle
`manager` n'a pas d'équivalent CTFd : il est vérifié par `manager_required`.
"""

import functools

from flask import abort, session

from CTFd.models import UserFieldEntries, UserFields, Users, db
from CTFd.utils.user import get_current_user

from .auth import ensure_token_login

FIELD_ROLES = "pad_roles"

ROLE_MANAGER = "manager"
ROLE_ADMIN = "admin"


class OidcIdentity(db.Model):
    __tablename__ = "pad_oidc_identities"
    sub = db.Column(db.String(255), primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )


def _field(name, description):
    field = UserFields.query.filter_by(name=name).first()
    if field is None:
        field = UserFields(
            name=name,
            field_type="text",
            description=description,
            required=False,
            public=False,
            editable=False,
        )
        db.session.add(field)
        db.session.commit()
    return field


def ensure_fields():
    _field(FIELD_ROLES, "PAD : rôles applicatifs (géré par sso_bridge)")


def _entry(user_id, field_name):
    field = UserFields.query.filter_by(name=field_name).first()
    if field is None:
        return None, None
    entry = UserFieldEntries.query.filter_by(
        user_id=user_id, field_id=field.id
    ).first()
    return field, entry


def _set_entry(user_id, field_name, value):
    field, entry = _entry(user_id, field_name)
    if field is None:
        ensure_fields()
        field, entry = _entry(user_id, field_name)
    if entry is None:
        entry = UserFieldEntries(user_id=user_id, field_id=field.id, value=value)
        db.session.add(entry)
    else:
        entry.value = value


def get_roles(user):
    if user is None:
        return []
    roles = []
    _, entry = _entry(user.id, FIELD_ROLES)
    if entry is not None and isinstance(entry.value, list):
        roles = [str(r) for r in entry.value]
    if user.type == "admin" and ROLE_ADMIN not in roles:
        roles.append(ROLE_ADMIN)
    return sorted(set(roles))


def set_roles(user, roles):
    _set_entry(user.id, FIELD_ROLES, sorted(set(roles)))


def set_sub(user, sub):
    identity = OidcIdentity.query.filter_by(user_id=user.id).first()
    if identity is None:
        db.session.add(OidcIdentity(sub=sub, user_id=user.id))
    elif identity.sub != sub:
        identity.sub = sub


def find_user_by_sub(sub):
    identity = OidcIdentity.query.filter_by(sub=sub).first()
    if identity is None:
        return None
    return Users.query.filter_by(id=identity.user_id).first()


def is_manager(user):
    roles = get_roles(user)
    return ROLE_MANAGER in roles or ROLE_ADMIN in roles


def manager_required(f):
    """Décorateur : rôle manager (ou admin CTFd) requis, via session ou token."""

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        ensure_token_login()
        if not session.get("id"):
            abort(401, description="Authentication required")
        user = get_current_user()
        if not is_manager(user):
            abort(403, description="Manager role required")
        return f(*args, **kwargs)

    return wrapper
