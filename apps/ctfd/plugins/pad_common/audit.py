"""Journal d'audit structuré des actions de modération (une ligne JSON par action).

Logger `pad.audit`, niveau INFO, une ligne JSON sur stderr (collectée comme le
reste des logs du pod). Aucun secret ni donnée personnelle superflue :
identifiants, noms de comptes et changements, jamais d'e-mail, de mot de passe,
de token ni de flag soumis.
"""

import json
import logging
import sys

from flask import has_request_context, request

LOGGER_NAME = "pad.audit"

logger = logging.getLogger(LOGGER_NAME)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)


def audit(action, actor, target_kind, target_id, target_name=None, **fields):
    """Journalise une action ; retourne l'enregistrement émis (utile aux tests)."""
    record = {
        "event": "pad.audit",
        "action": action,
        "actor_id": getattr(actor, "id", None),
        "actor_name": getattr(actor, "name", None),
        "target_kind": target_kind,
        "target_id": target_id,
        "target_name": target_name,
    }
    record.update(fields)
    if has_request_context():
        record["ip"] = request.remote_addr
    logger.info(json.dumps(record, sort_keys=True, default=str))
    return record
