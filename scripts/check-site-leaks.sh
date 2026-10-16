#!/usr/bin/env bash
# Garde-fou du repo public : échoue si une valeur propre à un site réel (IP, nom d'hôte, outils d'accès...) réapparaît.
#
# Les motifs interdits ne figurent PAS en clair ici : seulement l'empreinte sha256 de leur forme normalisée
# (minuscules). Chaque fichier suivi par git est découpé en jetons (mots alphanumériques, mots composés avec « - », « _ »
# ou « . », leurs sous-mots, préfixes /24 des IPv4) et l'empreinte de chaque jeton est comparée à la liste.
# Seuls fichier:ligne sont affichés, jamais la valeur trouvée.
#
# Usage : scripts/check-site-leaks.sh [fichier...]   (sans argument : tous les fichiers suivis par git)
# Appelé par scripts/lint.sh et la CI. Les valeurs de site vont dans secrets/site.sops.yaml (chiffré), jamais dans le repo.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "KO python3 manquant (nécessaire à check-site-leaks)" >&2
  exit 2
fi

exec python3 -I - "$@" <<'PY'
import hashlib
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN = {
    "cd5f1eb0d008a9f68a213bb322c2e0f7d197671e9bb13186b3e637011622327e",
    "48af964bc25856f20623998e917bd5085f0cf586e4a2d8d5a6d15a29d579af19",
    "555d209d2e0622fdd27265c177ff1598c0a4ed9f7ad24276d55fb58be70a4e54",
    "22efa3adaada68afe8d22e0f8e080c9fd6a7448b06422610db72e2680a73a155",
    "fc50f722595bfde85c491c597b981107a5c958f1a8654016df1b3c05c7b50248",
    "c9f5efcb689c4d2c241ba76cc3619d437fb1e092a1597150bb2f96c94e097f05",
    "795b104abe3e4134960ca245ded0e617f162c751209347b7f003bc35e062f43e",
    "791dc82c39c048682e2c8bcc953dba44838997987e5678c161f257d6fc27bf4a",
}
SKIP_DIRS = {".git", "node_modules", ".state", ".terraform", ".next", ".collections"}
TOKEN = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
IPV4_PREFIX = re.compile(r"(?<![0-9.])(\d{1,3}\.\d{1,3}\.\d{1,3})(?=\.\d{1,3}(?![0-9]))")


def candidates(line: str):
    low = line.lower()
    for m in TOKEN.finditer(low):
        tok = m.group(0)
        yield tok
        parts = re.split(r"[-_.]", tok)
        if len(parts) > 1:
            yield from parts
            for i in range(len(parts) - 1):
                yield "-".join(parts[i:i + 2])
    for m in IPV4_PREFIX.finditer(low):
        yield m.group(1)


def digest(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def tracked(args):
    if args:
        return [Path(a) for a in args]
    try:
        out = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
        return [Path(p) for p in out.decode().split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        return [p for p in Path(".").rglob("*") if p.is_file() and not SKIP_DIRS & set(p.parts)]


bad = 0
for path in tracked(sys.argv[1:]):
    if SKIP_DIRS & set(path.parts) or not path.is_file():
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for n, line in enumerate(text.splitlines(), 1):
        if any(digest(c) in FORBIDDEN for c in set(candidates(line))):
            print(f"KO {path}:{n} : valeur propre à un site (à fournir dans secrets/site.sops.yaml, jamais dans le repo)")
            bad += 1
if bad:
    print(f"check-site-leaks : {bad} occurrence(s)", file=sys.stderr)
    sys.exit(1)
print("check-site-leaks OK")
PY
