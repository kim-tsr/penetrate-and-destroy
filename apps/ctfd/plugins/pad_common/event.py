"""Lecture de l'événement CTF (config CTFd `start` / `end` / `freeze` / `paused`).

Partagé par `manager_api` (GET/PATCH réservés aux managers) et `pad_public`
(GET `/api/v1/pad/event`, lisible par tout joueur authentifié).
"""

import time

from CTFd.utils import get_config

EVENT_STATES = ("not_started", "running", "paused", "frozen", "ended")


def event_json(now=None):
    """Objet événement : dates en epoch (secondes) ou None, `state` calculé."""
    now = time.time() if now is None else now
    start = int(get_config("start") or 0)
    end = int(get_config("end") or 0)
    freeze = int(get_config("freeze") or 0)
    paused = bool(get_config("paused"))
    if start and now < start:
        state = "not_started"
    elif end and now > end:
        state = "ended"
    elif paused:
        state = "paused"
    elif freeze and now > freeze:
        state = "frozen"
    else:
        state = "running"
    return {
        "start": start or None,
        "end": end or None,
        "freeze": freeze or None,
        "paused": paused,
        "state": state,
    }
