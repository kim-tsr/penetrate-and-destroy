"""Schéma JSON de `challenge.yml` (format ctfcli + bloc `instance`).

Source unique : `challenges/schema/challenge.schema.json`, copié dans l'image
à côté de ce module par le Dockerfile. Aucun schéma de secours : s'il est
introuvable, le chargement échoue (évite toute divergence silencieuse).
Résolution :
1. `PAD_CHALLENGE_SCHEMA` (chemin) ;
2. `challenge.schema.json` à côté de ce fichier.
"""

import json
import os

from CTFd.plugins.pad_common.settings import setting


def load_schema():
    candidates = [
        setting("PAD_CHALLENGE_SCHEMA"),
        os.path.join(os.path.dirname(__file__), "challenge.schema.json"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    raise RuntimeError(
        "challenge.schema.json introuvable (PAD_CHALLENGE_SCHEMA ou fichier "
        "copié par le Dockerfile)"
    )
