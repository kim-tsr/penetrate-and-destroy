"""chall_manager_bridge : challenges instanciés par équipe via chall-manager.

- type de challenge `dynamic_instance` (référence du scénario chall-manager,
  configuration additionnelle, TTL, renouvellements, flag par instance) ;
- synchronisation du challenge dans chall-manager à la création, mise à jour
  et suppression (y compris via l'API admin native de CTFd) ;
- endpoints joueur (token API ou session) :
    GET    /api/v1/instances                 instances de l'équipe/joueur courant
    GET    /api/v1/instances/<challenge_id>  état d'une instance
    POST   /api/v1/instances/<challenge_id>  démarrage (quotas, cooldown)
    PATCH  /api/v1/instances/<challenge_id>  prolongation (TTL renouvelé)
    DELETE /api/v1/instances/<challenge_id>  arrêt

Identité « source » transmise à chall-manager : `team-<id>` en mode équipes,
`user-<id>` en mode individuel. Les flags d'instance ne sont jamais renvoyés.
"""

import datetime
import hmac

from flask import Blueprint, abort, request
from flask_restx import Namespace, Resource

from CTFd.api import CTFd_API_v1
from CTFd.exceptions.challenges import (
    ChallengeCreateException,
    ChallengeUpdateException,
)
from CTFd.models import Solves, db
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.challenges import (
    CHALLENGE_CLASSES,
    BaseChallenge,
    ChallengeResponse,
)
from CTFd.plugins.pad_common import chall_manager as cm
from CTFd.plugins.pad_common.auth import ensure_token_login
from CTFd.plugins.pad_common.roles import is_manager
from CTFd.plugins.pad_common.settings import setting, setting_int
from CTFd.utils import get_config
from CTFd.utils.dates import ctf_paused, ctftime
from CTFd.utils.modes import TEAMS_MODE
from CTFd.utils.user import get_current_team, get_current_user, is_admin

from .models import DynamicInstanceChallenge, InstanceRecord

TYPE_ID = "dynamic_instance"
OWN_FIELDS = (
    "scenario",
    "instance_config",
    "timeout",
    "until",
    "max_renewals",
    "per_instance_flag",
    "destroy_on_solve",
    "pool_min",
    "pool_max",
)
# Défauts = contrat (instances.max_per_team, instances.max_total) ; surchargés par PAD_INSTANCES_MAX_*.
# max_total reste sous la taille du pool LB-IPAM (100 IP) pour garder de la marge (courses, instances staff).
DEFAULT_MAX_PER_SOURCE = 3
DEFAULT_MAX_TOTAL = 90
BOOL_FIELDS = ("per_instance_flag", "destroy_on_solve")
INT_FIELDS = ("timeout", "max_renewals", "pool_min", "pool_max")


# --------------------------------------------------------------------------
# Synchronisation chall-manager
# --------------------------------------------------------------------------


def scenario_for(challenge):
    ref = challenge.scenario or setting("PAD_GENERIC_SCENARIO")
    if not ref:
        raise cm.ChallManagerError(
            400, "No scenario: set 'scenario' or PAD_GENERIC_SCENARIO"
        )
    return ref


def _iso(dt):
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


def sync_challenge(challenge):
    """Crée ou met à jour le challenge côté chall-manager."""
    return cm.upsert_challenge(
        challenge.id,
        scenario_for(challenge),
        timeout=challenge.timeout or None,
        until=_iso(challenge.until),
        additional=challenge.get_config(),
        min_pool=challenge.pool_min or 0,
        max_pool=challenge.pool_max or 0,
    )


def _coerce(data):
    out = {}
    for key, value in data.items():
        if key in BOOL_FIELDS and isinstance(value, str):
            value = value.strip().lower() in ("1", "true", "on", "yes")
        elif key in INT_FIELDS and value not in (None, ""):
            value = int(value)
        elif key == "until":
            if value in (None, ""):
                value = None
            elif isinstance(value, str):
                value = datetime.datetime.fromisoformat(
                    value.replace("Z", "+00:00")
                ).replace(tzinfo=None)
        out[key] = value
    return out


class DynamicInstanceChallengeType(BaseChallenge):
    id = TYPE_ID
    name = "dynamic_instance"
    templates = {
        "create": "/plugins/chall_manager_bridge/assets/create.html",
        "update": "/plugins/chall_manager_bridge/assets/update.html",
        "view": "/plugins/challenges/assets/view.html",
    }
    scripts = {
        "create": "/plugins/chall_manager_bridge/assets/create.js",
        "update": "/plugins/chall_manager_bridge/assets/update.js",
        "view": "/plugins/challenges/assets/view.js",
    }
    route = "/plugins/chall_manager_bridge/assets/"
    blueprint = Blueprint(
        "chall_manager_bridge", __name__, template_folder="templates",
        static_folder="assets",
    )
    challenge_model = DynamicInstanceChallenge

    @classmethod
    def create(cls, request):
        data = dict(request.form or request.get_json() or {})
        data = _coerce(data)
        try:
            challenge = DynamicInstanceChallenge(**data)
        except (TypeError, ValueError) as exc:
            raise ChallengeCreateException(str(exc))
        db.session.add(challenge)
        db.session.commit()
        try:
            sync_challenge(challenge)
        except cm.ChallManagerError as exc:
            # Pas de challenge CTFd orphelin si chall-manager refuse le scénario.
            cls.delete(challenge, remote=False)
            raise ChallengeCreateException(f"chall-manager: {exc.message}")
        return challenge

    @classmethod
    def read(cls, challenge):
        challenge = DynamicInstanceChallenge.query.filter_by(id=challenge.id).first()
        data = super().read(challenge)
        data["instance"] = {
            "timeout": challenge.timeout,
            "until": _iso(challenge.until),
            "max_renewals": challenge.max_renewals,
            "per_instance_flag": bool(challenge.per_instance_flag),
        }
        if is_admin():
            data.update(
                {
                    "scenario": challenge.scenario,
                    "instance_config": challenge.get_config(),
                    "timeout": challenge.timeout,
                    "until": _iso(challenge.until),
                    "max_renewals": challenge.max_renewals,
                    "per_instance_flag": bool(challenge.per_instance_flag),
                    "destroy_on_solve": bool(challenge.destroy_on_solve),
                    "pool_min": challenge.pool_min,
                    "pool_max": challenge.pool_max,
                }
            )
        return data

    @classmethod
    def update(cls, challenge, request):
        data = _coerce(dict(request.form or request.get_json() or {}))
        config = data.pop("instance_config", None)
        for attr, value in data.items():
            if attr in ("initial", "minimum", "decay") and value is not None:
                value = float(value)
            setattr(challenge, attr, value)
        if config is not None:
            challenge.set_config(config)
        db.session.commit()
        try:
            sync_challenge(challenge)
        except cm.ChallManagerError as exc:
            raise ChallengeUpdateException(f"chall-manager: {exc.message}")
        return challenge

    @classmethod
    def delete(cls, challenge, remote=True):
        if remote:
            try:
                cm.delete_challenge(challenge.id)
            except cm.ChallManagerError as exc:
                if exc.status not in (404, 503):
                    raise
        InstanceRecord.query.filter_by(challenge_id=challenge.id).delete()
        db.session.commit()
        super().delete(challenge)

    @classmethod
    def attempt(cls, challenge, request):
        challenge = DynamicInstanceChallenge.query.filter_by(id=challenge.id).first()
        if not challenge.per_instance_flag:
            return super().attempt(challenge, request)
        data = request.form or request.get_json()
        submission = data["submission"].strip()
        try:
            instance = cm.get_instance(challenge.id, current_source_id())
        except cm.ChallManagerError as exc:
            if exc.status == 404:
                return ChallengeResponse(
                    status="incorrect",
                    message="Démarrez votre instance avant de soumettre un flag",
                )
            abort(502, description="chall-manager unavailable")
        for flag in cm.instance_flags(instance):
            if hmac.compare_digest(flag.encode(), submission.encode()):
                return ChallengeResponse(status="correct", message="Correct")
        return ChallengeResponse(status="incorrect", message="Incorrect")

    @classmethod
    def solve(cls, user, team, challenge, request):
        super().solve(user, team, challenge, request)
        challenge = DynamicInstanceChallenge.query.filter_by(id=challenge.id).first()
        if challenge.destroy_on_solve:
            source = source_id_for(user, team)
            try:
                cm.delete_instance(challenge.id, source)
            except cm.ChallManagerError:
                pass  # le janitor nettoiera à l'expiration
            InstanceRecord.query.filter_by(
                challenge_id=challenge.id, source_id=source
            ).delete()
            db.session.commit()


# --------------------------------------------------------------------------
# Endpoints joueurs
# --------------------------------------------------------------------------


def source_id_for(user, team):
    if get_config("user_mode") == TEAMS_MODE:
        if team is None:
            abort(403, description="You must join a team first")
        return f"team-{team.id}"
    return f"user-{user.id}"


def current_source_id():
    user = get_current_user()
    team = get_current_team() if get_config("user_mode") == TEAMS_MODE else None
    return source_id_for(user, team)


def _privileged(user):
    return is_admin() or is_manager(user)


def _parse_ts(value):
    if not value:
        return None
    value = str(value).replace("Z", "+00:00")
    # Les timestamps protobuf peuvent avoir des nanosecondes : on tronque.
    if "." in value:
        head, tail = value.split(".", 1)
        frac = "".join(ch for ch in tail if ch.isdigit())[:6]
        tz = tail[len("".join(ch for ch in tail if ch.isdigit())):]
        value = f"{head}.{frac}{tz}"
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt


def serialize(instance, challenge, record=None):
    until = _parse_ts(instance.get("until"))
    now = datetime.datetime.utcnow()
    renewals = record.renewals if record else 0
    max_renewals = challenge.max_renewals if challenge else 0
    return {
        "challenge_id": int(instance.get("challenge_id") or challenge.id),
        "source_id": instance.get("source_id"),
        "connection_info": instance.get("connection_info", ""),
        "since": instance.get("since"),
        "last_renew": instance.get("last_renew"),
        "until": instance.get("until"),
        "expires_in": max(0, int((until - now).total_seconds())) if until else None,
        "renewals": renewals,
        "max_renewals": max_renewals,
        "renewals_left": max(0, (max_renewals or 0) - renewals),
        "per_instance_flag": bool(challenge.per_instance_flag) if challenge else False,
    }


def _cm_abort(exc):
    if exc.status in (400, 404, 409):
        abort(exc.status, description=exc.message)
    abort(502, description="chall-manager unavailable")


def _load_challenge(challenge_id, user):
    challenge = DynamicInstanceChallenge.query.filter_by(id=challenge_id).first()
    if challenge is None:
        abort(404, description="No instanced challenge with this id")
    if _privileged(user):
        return challenge
    if challenge.state != "visible":
        abort(404, description="No instanced challenge with this id")
    prereqs = set((challenge.requirements or {}).get("prerequisites") or [])
    if prereqs:
        solved = {
            cid
            for (cid,) in Solves.query.with_entities(Solves.challenge_id)
            .filter_by(account_id=user.account_id)
            .all()
        }
        if not prereqs.issubset(solved):
            abort(403, description="Prerequisites not met")
    return challenge


def _check_event_open(user):
    if _privileged(user):
        return
    if ctf_paused():
        abort(403, description="The CTF is paused")
    if not ctftime():
        abort(403, description="The CTF is not running")


def _total_instances():
    """Instances vivantes de toute la plateforme (enregistrements non expirés + instances préchauffées)."""
    now = datetime.datetime.utcnow()
    live = InstanceRecord.query.filter(
        (InstanceRecord.until.is_(None)) | (InstanceRecord.until > now)
    ).count()
    warm = db.session.query(
        db.func.coalesce(db.func.sum(DynamicInstanceChallenge.pool_min), 0)
    ).scalar()
    return live + int(warm or 0)


def _record(challenge_id, source):
    return InstanceRecord.query.filter_by(
        challenge_id=challenge_id, source_id=source
    ).first()


def _sync_record(challenge_id, source, instance, owner_id=None):
    record = _record(challenge_id, source)
    until = _parse_ts(instance.get("until"))
    if record is None:
        record = InstanceRecord(
            challenge_id=challenge_id, source_id=source, owner_user_id=owner_id,
            until=until, renewals=0,
        )
        db.session.add(record)
    else:
        record.until = until
    db.session.commit()
    return record


instances_namespace = Namespace(
    "instances", description="Instances de challenges (chall-manager)"
)


@instances_namespace.route("")
class InstanceList(Resource):
    def get(self):
        ensure_token_login() or abort(401)
        source = current_source_id()
        try:
            items = cm.query_instances(source)
        except cm.ChallManagerError as exc:
            _cm_abort(exc)
        out = []
        for inst in items:
            try:
                cid = int(inst.get("challenge_id"))
            except (TypeError, ValueError):
                continue
            challenge = DynamicInstanceChallenge.query.filter_by(id=cid).first()
            if challenge is None:
                continue
            out.append(serialize(inst, challenge, _record(cid, source)))
        # Réconciliation : on oublie les enregistrements disparus côté chall-manager.
        alive = {i["challenge_id"] for i in out}
        for rec in InstanceRecord.query.filter_by(source_id=source).all():
            if rec.challenge_id not in alive:
                db.session.delete(rec)
        db.session.commit()
        return {"success": True, "data": out}


@instances_namespace.route("/<int:challenge_id>")
class InstanceItem(Resource):
    def get(self, challenge_id):
        user = ensure_token_login() or abort(401)
        challenge = _load_challenge(challenge_id, user)
        source = current_source_id()
        try:
            inst = cm.get_instance(challenge.id, source)
        except cm.ChallManagerError as exc:
            if exc.status == 404:
                InstanceRecord.query.filter_by(
                    challenge_id=challenge.id, source_id=source
                ).delete()
                db.session.commit()
            _cm_abort(exc)
        record = _sync_record(challenge.id, source, inst)
        return {"success": True, "data": serialize(inst, challenge, record)}

    def post(self, challenge_id):
        user = ensure_token_login() or abort(401)
        challenge = _load_challenge(challenge_id, user)
        _check_event_open(user)
        source = current_source_id()
        existing = _record(challenge.id, source)
        if existing is not None:
            # L'instance a pu être détruite par le janitor à expiration.
            try:
                cm.get_instance(challenge.id, source)
            except cm.ChallManagerError as exc:
                if exc.status != 404:
                    _cm_abort(exc)
                db.session.delete(existing)
                db.session.commit()
            else:
                abort(409, description="Instance already exists")

        # Quota d'instances simultanées par équipe/joueur.
        limit = setting_int("PAD_INSTANCES_MAX_PER_SOURCE", DEFAULT_MAX_PER_SOURCE)
        now = datetime.datetime.utcnow()
        active = InstanceRecord.query.filter(
            InstanceRecord.source_id == source,
            InstanceRecord.challenge_id != challenge.id,
            (InstanceRecord.until.is_(None)) | (InstanceRecord.until > now),
        ).count()
        if limit and active >= limit and not _privileged(user):
            abort(429, description=f"Instance quota reached ({limit})")

        # Limite globale : chaque instance consomme une IP du pool LB-IPAM et des ressources du pool
        # challenges. Les instances préchauffées (pool_min) comptent aussi. Les managers/admins en sont exempts.
        max_total = setting_int("PAD_INSTANCES_MAX_TOTAL", DEFAULT_MAX_TOTAL)
        if max_total and not _privileged(user) and _total_instances() >= max_total:
            abort(
                503,
                description=(
                    "Le nombre maximal d'instances simultanées de la plateforme est atteint. "
                    "Réessayez dans quelques minutes ou arrêtez une instance inutile."
                ),
            )

        # Cooldown anti-spam entre deux créations pour une même source.
        from CTFd.cache import cache

        cooldown = setting_int("PAD_INSTANCES_COOLDOWN_SECONDS", 30)
        if cooldown and not cache.add(f"pad:inst:cooldown:{source}", 1,
                                      timeout=cooldown):
            if not _privileged(user):
                abort(429, description="Please wait before starting another instance")

        mode = "team" if source.startswith("team-") else "user"
        additional = {
            "pad_source_kind": mode,
            "pad_source_id": source.split("-", 1)[1],
            "pad_challenge_id": str(challenge.id),
        }
        try:
            inst = cm.create_instance(challenge.id, source, additional)
        except cm.ChallManagerError as exc:
            cache.delete(f"pad:inst:cooldown:{source}")
            _cm_abort(exc)
        record = _sync_record(challenge.id, source, inst, owner_id=user.id)
        record.renewals = 0
        db.session.commit()
        return {"success": True, "data": serialize(inst, challenge, record)}, 201

    def patch(self, challenge_id):
        user = ensure_token_login() or abort(401)
        challenge = _load_challenge(challenge_id, user)
        _check_event_open(user)
        source = current_source_id()
        record = _record(challenge.id, source)
        renewals = record.renewals if record else 0
        if (
            challenge.max_renewals is not None
            and renewals >= challenge.max_renewals
            and not _privileged(user)
        ):
            abort(429, description="No renewal left for this instance")
        try:
            inst = cm.renew_instance(challenge.id, source)
        except cm.ChallManagerError as exc:
            _cm_abort(exc)
        record = _sync_record(challenge.id, source, inst)
        record.renewals = renewals + 1
        db.session.commit()
        return {"success": True, "data": serialize(inst, challenge, record)}

    def delete(self, challenge_id):
        user = ensure_token_login() or abort(401)
        challenge = _load_challenge(challenge_id, user)
        source = current_source_id()
        try:
            cm.delete_instance(challenge.id, source)
        except cm.ChallManagerError as exc:
            if exc.status != 404:
                _cm_abort(exc)
        InstanceRecord.query.filter_by(
            challenge_id=challenge.id, source_id=source
        ).delete()
        db.session.commit()
        return {"success": True, "data": {}}


def load(app):
    with app.app_context():
        db.create_all()
    CHALLENGE_CLASSES[TYPE_ID] = DynamicInstanceChallengeType
    register_plugin_assets_directory(
        app, base_path="/plugins/chall_manager_bridge/assets/"
    )
    CTFd_API_v1.add_namespace(instances_namespace, "/instances")
    with app.app_context():
        app.logger.info(
            "chall_manager_bridge: chall-manager=%s, scénario générique=%s",
            setting("PAD_CHALL_MANAGER_URL"),
            setting("PAD_GENERIC_SCENARIO"),
        )
