"""Faux chall-manager (API REST v1) en mémoire, pour les tests e2e et de charge locaux.

Reprend le contrat consommé par apps/ctfd/plugins/pad_common/chall_manager.py (même comportement que
apps/ctfd/tests/fake_cm.py) :
  POST   /api/v1/challenge                       crée (409 si existe)
  GET    /api/v1/challenge/{id}                  lit
  PATCH  /api/v1/challenge/{id}                  met à jour
  DELETE /api/v1/challenge/{id}                  supprime (et ses instances)
  POST   /api/v1/instance                        crée (409 si existe)
  GET    /api/v1/instance?source_id=...          flux NDJSON {"result": Instance}
  GET    /api/v1/instance/{cid}/{sid}            lit
  PATCH  /api/v1/instance/{cid}/{sid}            renouvelle
  DELETE /api/v1/instance/{cid}/{sid}            supprime
  GET    /healthz                                sonde de vie
Aucune authentification, aucun conteneur lancé : ne jamais exposer hors d'un poste de test.
Variables : PORT (8080), MOCK_LATENCY_MS (0, latence simulée pour la création d'instance), MOCK_FLAG.
"""

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.Lock()
CHALLENGES = {}
INSTANCES = {}
LATENCY = int(os.environ.get("MOCK_LATENCY_MS", "0")) / 1000
FLAG = os.environ.get("MOCK_FLAG", "PAD{e2e-instance-flag}")


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"


def _instance(cid, sid, additional):
    timeout = int(str(CHALLENGES[cid].get("timeout", "600s")).rstrip("s") or 600)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "challenge_id": cid,
        "source_id": sid,
        "since": _iso(now),
        "last_renew": _iso(now),
        "until": _iso(now + timedelta(seconds=timeout)),
        "connection_info": f"nc mock-instance.invalid 1337 # {sid}",
        "flags": [FLAG],
        "additional": additional or {},
    }


def _err(status, code, message, reason):
    return status, {"code": code, "message": message, "details": [{"reason": reason}]}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mock-chall-manager"

    def log_message(self, fmt, *args):  # journaux JSON, une ligne par requête
        print(json.dumps({"ts": time.time(), "client": self.client_address[0], "msg": fmt % args}), flush=True)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    def _send(self, status, body=None, raw=None):
        payload = raw if raw is not None else json.dumps(body if body is not None else {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _route(self, method):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        body = self._body() if method in ("POST", "PATCH") else {}
        if path == "/healthz":
            return 200, {"status": "ok"}
        if LATENCY and path == "/api/v1/instance" and method == "POST":
            time.sleep(LATENCY)  # simule le temps de provisionnement, hors verrou
        with LOCK:
            if path == "/api/v1/challenge" and method == "POST":
                if body.get("id") in CHALLENGES:
                    return _err(409, 6, "Challenge already exists.", "CHALLENGE_ALREADY_EXISTS")
                CHALLENGES[body["id"]] = dict(body)
                return 200, body
            m = re.fullmatch(r"/api/v1/challenge/([^/]+)", path)
            if m:
                cid = m.group(1)
                if cid not in CHALLENGES:
                    return _err(404, 5, "Challenge not found.", "CHALLENGE_NOT_FOUND")
                if method == "PATCH":
                    CHALLENGES[cid].update({k: v for k, v in body.items() if k != "update_mask"})
                elif method == "DELETE":
                    del CHALLENGES[cid]
                    for key in [k for k in INSTANCES if k[0] == cid]:
                        del INSTANCES[key]
                    return 200, {}
                return 200, CHALLENGES[cid]
            if path == "/api/v1/instance" and method == "POST":
                cid, sid = body.get("challenge_id"), body.get("source_id")
                if cid not in CHALLENGES:
                    return _err(404, 5, "Challenge not found.", "CHALLENGE_NOT_FOUND")
                if (cid, sid) in INSTANCES:
                    return _err(409, 6, "Instance already exists.", "INSTANCE_ALREADY_EXISTS")
                INSTANCES[(cid, sid)] = _instance(cid, sid, body.get("additional"))
                return 200, INSTANCES[(cid, sid)]
            if path == "/api/v1/instance" and method == "GET":
                sid = (query.get("source_id") or [""])[0]
                lines = [json.dumps({"result": i}) for (_, s), i in INSTANCES.items() if s == sid]
                return 200, None, "\n".join(lines).encode()
            m = re.fullmatch(r"/api/v1/instance/([^/]+)/([^/]+)", path)
            if m:
                key = (m.group(1), m.group(2))
                if key not in INSTANCES:
                    return _err(404, 5, "Instance not found.", "INSTANCE_NOT_FOUND")
                if method == "DELETE":
                    del INSTANCES[key]
                    return 200, {}
                if method == "PATCH":
                    since = INSTANCES[key]["since"]
                    INSTANCES[key] = _instance(key[0], key[1], INSTANCES[key]["additional"])
                    INSTANCES[key]["since"] = since
                return 200, INSTANCES[key]
        return 404, {"code": 5, "message": "Not Found"}

    def _handle(self, method):
        result = self._route(method)
        if len(result) == 3:
            self._send(result[0], raw=result[2])
        else:
            self._send(result[0], result[1])

    def do_GET(self):  # noqa: N802
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_PATCH(self):  # noqa: N802
        self._handle("PATCH")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
