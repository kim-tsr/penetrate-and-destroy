#!/usr/bin/env python3
"""Convertit des CustomResourceDefinitions (YAML multi-documents, via `yq -o json`) en
schémas JSON au format attendu par kubeconform : <dossier>/<group>/<kind>_<version>.json
(kind en minuscules), avec additionalProperties=false (équivalent de openapi2jsonschema strict).

Usage : yq -o json -I0 'select(.kind == "CustomResourceDefinition")' crds.yaml \
          | crd2schema.py <dossier-sortie>
Entrée : un objet JSON par ligne.
"""
import json
import os
import sys


def strict(node):
    """Ajoute additionalProperties: false aux objets décrits par `properties`,
    sauf s'ils préservent les champs inconnus (x-kubernetes-preserve-unknown-fields)."""
    if isinstance(node, dict):
        if (
            "properties" in node
            and "additionalProperties" not in node
            and not node.get("x-kubernetes-preserve-unknown-fields")
        ):
            node["additionalProperties"] = False
        for value in node.values():
            strict(value)
    elif isinstance(node, list):
        for value in node:
            strict(value)
    return node


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = sys.argv[1]
    count = 0
    for line in sys.stdin:
        line = line.strip()
        if not line or line == "null":
            continue
        crd = json.loads(line)
        group = crd["spec"]["group"]
        kind = crd["spec"]["names"]["kind"].lower()
        for version in crd["spec"].get("versions", []):
            schema = (version.get("schema") or {}).get("openAPIV3Schema")
            if not schema:
                continue
            schema = strict(json.loads(json.dumps(schema)))
            # apiVersion/kind/metadata ne sont pas toujours décrits dans le CRD.
            props = schema.setdefault("properties", {})
            props.setdefault("apiVersion", {"type": "string"})
            props.setdefault("kind", {"type": "string"})
            props.setdefault("metadata", {"type": "object"})
            if isinstance(props.get("metadata"), dict):
                props["metadata"].pop("additionalProperties", None)
            path = os.path.join(out, group)
            os.makedirs(path, exist_ok=True)
            with open(os.path.join(path, f"{kind}_{version['name']}.json"), "w", encoding="utf-8") as fh:
                json.dump(schema, fh)
            count += 1
    print(f"{count} schémas écrits dans {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
