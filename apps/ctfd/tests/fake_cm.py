"""Faux chall-manager en mémoire, branché à la place de `requests.request`."""

import datetime
import json
import re
from unittest.mock import patch

import requests


class FakeResponse:
    def __init__(self, status, body=None, text=None):
        self.status_code = status
        if text is None:
            text = "" if body is None else json.dumps(body)
        self.text = text
        self.content = text.encode()

    def json(self):
        return json.loads(self.text)


def _err(status, code, message, reason):
    return FakeResponse(status, {"code": code, "message": message,
                                 "details": [{"reason": reason}]})


class FakeChallManager:
    def __init__(self, flags=None, down=False):
        self.challenges = {}
        self.instances = {}
        self.calls = []
        self.flags = flags or []
        self.down = down

    def _now(self):
        return datetime.datetime.utcnow().replace(microsecond=0)

    def _instance(self, cid, sid, additional):
        chal = self.challenges[cid]
        timeout = int(str(chal.get("timeout", "600s")).rstrip("s"))
        now = self._now()
        return {
            "challenge_id": cid,
            "source_id": sid,
            "since": now.isoformat() + "Z",
            "last_renew": now.isoformat() + "Z",
            "until": (now + datetime.timedelta(seconds=timeout)).isoformat()
            + ".123456789Z",
            "connection_info": f"nc 10.20.70.100 1337 # {sid}",
            "flags": list(self.flags),
            "additional": additional or {},
        }

    def __call__(self, method, url, json=None, params=None, **kwargs):  # noqa: A002
        if self.down:
            raise requests.ConnectionError("down")
        path = re.sub(r"^https?://[^/]+", "", url)
        self.calls.append((method, path, json, params))
        if path == "/api/v1/challenge" and method == "POST":
            if json["id"] in self.challenges:
                return _err(409, 6, "Challenge already exists.", "CHALLENGE_ALREADY_EXISTS")
            self.challenges[json["id"]] = dict(json)
            return FakeResponse(200, json)
        m = re.fullmatch(r"/api/v1/challenge/([^/]+)", path)
        if m:
            cid = m.group(1)
            if cid not in self.challenges:
                return _err(404, 5, "Challenge not found.", "CHALLENGE_NOT_FOUND")
            if method == "PATCH":
                self.challenges[cid].update({k: v for k, v in json.items()
                                             if k not in ("update_mask",)})
                return FakeResponse(200, self.challenges[cid])
            if method == "DELETE":
                del self.challenges[cid]
                for key in [k for k in self.instances if k[0] == cid]:
                    del self.instances[key]
                return FakeResponse(200, {})
            return FakeResponse(200, self.challenges[cid])
        if path == "/api/v1/instance" and method == "POST":
            cid, sid = json["challenge_id"], json["source_id"]
            if cid not in self.challenges:
                return _err(404, 5, "Challenge not found.", "CHALLENGE_NOT_FOUND")
            if (cid, sid) in self.instances:
                return _err(409, 6, "Instance already exists.", "INSTANCE_ALREADY_EXISTS")
            inst = self._instance(cid, sid, json.get("additional"))
            self.instances[(cid, sid)] = inst
            return FakeResponse(200, inst)
        if path == "/api/v1/instance" and method == "GET":
            sid = params["source_id"]
            lines = [__import__("json").dumps({"result": i})
                     for (c, s), i in self.instances.items() if s == sid]
            return FakeResponse(200, text="\n".join(lines))
        m = re.fullmatch(r"/api/v1/instance/([^/]+)/([^/]+)", path)
        if m:
            key = (m.group(1), m.group(2))
            if key not in self.instances:
                return _err(404, 5, "Instance not found.", "INSTANCE_NOT_FOUND")
            if method == "DELETE":
                del self.instances[key]
                return FakeResponse(200, {})
            if method == "PATCH":
                inst = self._instance(key[0], key[1],
                                      self.instances[key]["additional"])
                inst["since"] = self.instances[key]["since"]
                self.instances[key] = inst
                return FakeResponse(200, inst)
            return FakeResponse(200, self.instances[key])
        return FakeResponse(404, {"code": 5, "message": "Not Found"})


def install(fake):
    return patch("CTFd.plugins.pad_common.chall_manager.requests.request", fake)
