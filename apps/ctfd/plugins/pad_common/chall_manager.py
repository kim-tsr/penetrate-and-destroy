"""Client minimal de l'API REST (grpc-gateway) de chall-manager v0.6.x.

Référence : ctfer-io/chall-manager, api/v1/{challenge,instance}/*.proto
- POST   /api/v1/challenge                          CreateChallengeRequest
- GET    /api/v1/challenge/{id}
- PATCH  /api/v1/challenge/{id}                     UpdateChallengeRequest
- DELETE /api/v1/challenge/{id}
- POST   /api/v1/instance                           CreateInstanceRequest
- GET    /api/v1/instance/{challenge_id}/{source_id}
- GET    /api/v1/instance?source_id=...             (stream NDJSON)
- PATCH  /api/v1/instance/{challenge_id}/{source_id} (renouvellement)
- DELETE /api/v1/instance/{challenge_id}/{source_id}

Durées au format protobuf JSON (`"600s"`), dates en RFC 3339.
"""

import json

import requests

from .settings import setting, setting_int


class ChallManagerError(Exception):
    def __init__(self, status, message, reason=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.reason = reason


def _base_url():
    url = setting("PAD_CHALL_MANAGER_URL")
    if not url:
        raise ChallManagerError(503, "chall-manager URL not configured")
    return url.rstrip("/")


def _request(method, path, payload=None, params=None):
    timeout = setting_int("PAD_CHALL_MANAGER_TIMEOUT_SECONDS", 300)
    try:
        resp = requests.request(
            method,
            _base_url() + path,
            json=payload,
            params=params,
            timeout=(5, timeout),
            headers={"Accept": "application/json"},
        )
    except requests.RequestException as exc:
        raise ChallManagerError(502, f"chall-manager unreachable: {exc}") from exc
    if resp.status_code >= 400:
        reason = None
        message = resp.text[:500]
        try:
            body = resp.json()
            message = body.get("message", message)
            for detail in body.get("details") or []:
                if "reason" in detail:
                    reason = detail["reason"]
                    break
        except ValueError:
            pass
        raise ChallManagerError(resp.status_code, message, reason)
    return resp


def _json(resp):
    if not resp.content:
        return {}
    return resp.json()


def duration(seconds):
    return f"{int(seconds)}s"


def parse_duration(value):
    """`"600s"` -> 600 (None si absent)."""
    if not value:
        return None
    return int(float(str(value).rstrip("s")))


# --- Challenges -------------------------------------------------------------


def challenge_payload(challenge_id, scenario, timeout=None, until=None,
                      additional=None, min_pool=0, max_pool=0):
    payload = {"id": str(challenge_id), "scenario": scenario}
    if timeout:
        payload["timeout"] = duration(timeout)
    if until:
        payload["until"] = until
    if additional:
        payload["additional"] = {str(k): str(v) for k, v in additional.items()}
    if min_pool:
        payload["min"] = int(min_pool)
    if max_pool:
        payload["max"] = int(max_pool)
    return payload


def get_challenge(challenge_id):
    return _json(_request("GET", f"/api/v1/challenge/{challenge_id}"))


def upsert_challenge(challenge_id, scenario, timeout=None, until=None,
                     additional=None, min_pool=0, max_pool=0):
    """Crée le challenge, ou le met à jour s'il existe déjà."""
    payload = challenge_payload(challenge_id, scenario, timeout, until,
                                additional, min_pool, max_pool)
    try:
        return _json(_request("POST", "/api/v1/challenge", payload))
    except ChallManagerError as exc:
        if exc.status != 409:
            raise
    update = dict(payload)
    update.pop("id")
    # update_mask explicite : sans lui, grpc-gateway déduit le masque des
    # champs présents ; on l'impose pour pouvoir effacer timeout/until.
    update["update_mask"] = ",".join(
        ["scenario", "timeout", "until", "additional", "min", "max"]
    )
    update.setdefault("timeout", None)
    update.setdefault("until", None)
    update.setdefault("additional", {})
    update.setdefault("min", 0)
    update.setdefault("max", 0)
    update["update_strategy"] = setting(
        "PAD_CHALL_MANAGER_UPDATE_STRATEGY", "update_in_place"
    )
    return _json(_request("PATCH", f"/api/v1/challenge/{challenge_id}", update))


def delete_challenge(challenge_id):
    try:
        _request("DELETE", f"/api/v1/challenge/{challenge_id}")
    except ChallManagerError as exc:
        if exc.status != 404:
            raise


# --- Instances --------------------------------------------------------------


def create_instance(challenge_id, source_id, additional=None):
    payload = {"challenge_id": str(challenge_id), "source_id": str(source_id)}
    if additional:
        payload["additional"] = {str(k): str(v) for k, v in additional.items()}
    return _json(_request("POST", "/api/v1/instance", payload))


def get_instance(challenge_id, source_id):
    return _json(_request("GET", f"/api/v1/instance/{challenge_id}/{source_id}"))


def renew_instance(challenge_id, source_id):
    return _json(
        _request(
            "PATCH",
            f"/api/v1/instance/{challenge_id}/{source_id}",
            {"challenge_id": str(challenge_id), "source_id": str(source_id)},
        )
    )


def delete_instance(challenge_id, source_id):
    _request("DELETE", f"/api/v1/instance/{challenge_id}/{source_id}")


def query_instances(source_id):
    """RPC en stream : grpc-gateway renvoie un objet `{"result": ...}` par ligne."""
    resp = _request("GET", "/api/v1/instance", params={"source_id": str(source_id)})
    out = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        if "error" in obj:
            err = obj["error"]
            raise ChallManagerError(502, err.get("message", "stream error"))
        out.append(obj.get("result", obj))
    return out


def instance_flags(instance):
    """Flags d'une instance (champ `flags`, ou `flag` déprécié)."""
    flags = list(instance.get("flags") or [])
    if instance.get("flag"):
        flags.append(instance["flag"])
    return [f for f in flags if f]
