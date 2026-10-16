#!/usr/bin/env python3
"""Valide tous les challenge.yml contre schema/challenge.schema.json (pyyaml + jsonschema)."""
import json
import re
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent
DURATION = re.compile(r"^(\d+)\s*(s|m|h)$")


def extra_checks(doc):
    """Contraintes du zod non exprimables en JSON Schema."""
    errs = []
    extra = doc.get("extra")
    if isinstance(extra, dict) and extra.get("minimum", 0) > extra.get("initial", 0):
        errs.append("extra.minimum: doit être <= initial")
    ttl = (doc.get("instance") or {}).get("ttl")
    if isinstance(ttl, str) and (m := DURATION.match(ttl)):
        secs = int(m[1]) * {"s": 1, "m": 60, "h": 3600}[m[2]]
        if not 60 <= secs <= 6 * 3600:
            errs.append("instance.ttl: entre 60 secondes et 6 heures")
    return errs


def main(argv):
    schema = json.loads((ROOT / "schema" / "challenge.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    files = [Path(a) for a in argv] or sorted(ROOT.glob("*/challenge.yml"))
    if not files:
        print("aucun challenge.yml trouvé", file=sys.stderr)
        return 1
    failed = 0
    for f in files:
        doc = yaml.safe_load(f.read_text())
        errs = [
            f"{'.'.join(map(str, e.absolute_path)) or '(racine)'}: {e.message}"
            for e in validator.iter_errors(doc)
        ]
        if not errs:
            errs = extra_checks(doc)
            errs += [f"files: {r} introuvable" for r in doc.get("files", []) if not (f.parent / r).is_file()]
        print(("KO " if errs else "OK ") + str(f))
        for e in errs:
            print("   - " + e)
        failed += bool(errs)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
