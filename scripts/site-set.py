#!/usr/bin/env python3
"""Valeurs de site NON secrètes qui doivent vivre dans Git : contrat + manifests gitops marqués.

Usage : scripts/site-set.py cle=valeur [cle=valeur ...]     (via `task site:set -- node=pve datastore_vm=vmdata`)
        scripts/site-set.py --show                          (valeurs courantes)

Clés : node, datastore_vm, datastore_iso, datastore_vm_type (zfspool|lvmthin|lvm|dir), wan_mode (routed_ip|nat), domain, acme_email, git_repo, git_ssh.
Idempotent : met à jour infra/contracts.yaml puis chaque ligne de gitops/ portant `# contracts: <marqueur>` (domain : toute
occurrence littérale de l'ancien domaine dans gitops/ hors *.sops.yaml). Les valeurs secrètes (URL de l'API Proxmox, accès SSH,
IP publique) restent dans secrets/site.sops.yaml et ne passent jamais par ici.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "infra/contracts.yaml"
NAME = r"[A-Za-z0-9][A-Za-z0-9._-]*"
# clé -> (chemin dans le contrat, marqueur gitops ou None, mode de remplacement, validation)
KEYS = {
    "node": (("host", "node"), "host.node", "word", r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"),
    "datastore_vm": (("host", "datastore_vm"), "host.datastore_vm", "word", rf"^{NAME}$"),
    "datastore_iso": (("host", "datastore_iso"), "host.datastore_iso", "word", rf"^{NAME}$"),
    "datastore_vm_type": (("host", "datastore_vm_type"), None, None, r"^(zfspool|lvmthin|lvm|dir)$"),
    "wan_mode": (("wan", "mode"), None, None, r"^(routed_ip|nat)$"),
    "domain": (("domain",), "domain", "domain", r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$|^CHANGEME\.example\.net$"),
    "acme_email": (("acme", "email"), "acme.email", "literal", r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$"),
    "git_repo": (("git", "repo"), "git.repo", "literal", r"^https://\S+$"),
    "git_ssh": (("git", "ssh"), "git.ssh", "literal", r"^\S+@\S+:\S+$"),
}


def die(msg):
    print(f"ERREUR {msg}", file=sys.stderr)
    sys.exit(1)


def get(path):
    """Valeur courante d'une clé du contrat (niveau 1 ou 2), ou None."""
    inside = len(path) == 1
    for ln in CONTRACT.read_text().splitlines():
        if len(path) == 2:
            if re.match(rf"^{path[0]}:\s*(#.*)?$", ln):
                inside = True
                continue
            if inside and re.match(r"^\S", ln):
                return None
        pat = rf"^{path[-1]}:\s*(\S+)" if len(path) == 1 else rf"^  {path[-1]}:\s*(\S+)"
        m = re.match(pat, ln) if inside else None
        if m:
            return m.group(1).strip("\"'")
    return None


def set_contract(path, new):
    out, inside, done = [], len(path) == 1, False
    for ln in CONTRACT.read_text().splitlines(keepends=True):
        if not done and len(path) == 2:
            if re.match(rf"^{path[0]}:\s*(#.*)?$", ln):
                inside = True
            elif inside and re.match(r"^\S", ln):
                inside = False
        if not done and inside:
            pat = rf"^({path[-1]}:[ \t]+)(\S+)" if len(path) == 1 else rf"^(  {path[-1]}:[ \t]+)(\S+)"
            m = re.match(pat, ln)
            if m:
                ln = m.group(1) + new + ln[m.end():]
                done = True
        out.append(ln)
    if not done and path == ("host", "datastore_vm_type"):  # clé nouvelle : insérée après datastore_vm
        out2 = []
        for ln in out:
            out2.append(ln)
            if re.match(r"^  datastore_vm:", ln):
                out2.append(f"  datastore_vm_type: {new}             # zfspool | lvmthin | lvm | dir : type du stockage datastore_vm\n")
        out, done = out2, True
    if not done:
        die(f"clé {'.'.join(path)} introuvable dans le contrat")
    CONTRACT.write_text("".join(out))


def gitops_files():
    for p in sorted((ROOT / "gitops").rglob("*")):
        if p.is_file() and p.suffix in {".yaml", ".yml", ".md"} and not p.name.endswith(".sops.yaml") and "node_modules" not in p.parts:
            yield p


def replace_marked(marker, old, new, mode):
    changed = []
    tag = re.compile(rf"# contracts: .*\b{re.escape(marker)}(?![\w.-])")
    for p in gitops_files():
        out, touched = [], False
        for ln in p.read_text().splitlines(keepends=True):
            if tag.search(ln):
                if mode == "word":
                    nl = re.sub(rf"(?<![\w.@!-]){re.escape(old)}(?![\w.@!-])", new, ln)
                else:
                    nl = ln.replace(old, new)
                touched |= nl != ln
                ln = nl
            out.append(ln)
        if touched:
            p.write_text("".join(out))
            changed.append(p)
    return changed


def replace_domain(old, new):
    changed = []
    for p in gitops_files():
        text = p.read_text()
        if old in text:
            p.write_text(text.replace(old, new))
            changed.append(p)
    return changed


def main():
    args = sys.argv[1:]
    if not args or args in (["-h"], ["--help"]):
        print(__doc__)
        sys.exit(0 if args else 2)
    if args == ["--show"]:
        for k, spec in KEYS.items():
            print(f"{k:18} = {get(spec[0])}")
        return
    todo = []
    for a in args:
        if "=" not in a:
            die(f"argument « {a} » : attendu cle=valeur (clés : {', '.join(KEYS)})")
        k, v = a.split("=", 1)
        if k not in KEYS:
            die(f"clé inconnue « {k} » (clés : {', '.join(KEYS)})")
        if not re.match(KEYS[k][3], v):
            die(f"valeur invalide pour {k} : « {v} »")
        todo.append((k, v))
    for k, v in todo:
        path, marker, mode, _ = KEYS[k]
        old = get(path)
        if old == v:
            print(f"{k} vaut déjà « {v} » : rien à faire")
            continue
        set_contract(path, v)
        files = []
        if mode == "domain":
            files = replace_domain(old, v)
            api_old = f"https://vpn.{old}/api"
            if get(("netbird", "api_url")) == api_old:
                set_contract(("netbird", "api_url"), f"https://vpn.{v}/api")
            email = get(("acme", "email"))
            if email and email.endswith("@" + old):  # l'adresse ACME suit le domaine tant qu'elle n'a pas été choisie
                set_contract(("acme", "email"), email[: -len(old)] + v)
        elif marker and old:
            files = replace_marked(marker, old, v, mode)
        print(f"{k} : {old} -> {v} (contrat + {len(files)} fichier(s) gitops)")
        for f in files:
            print(f"  mis à jour : {f.relative_to(ROOT)}")
    print("\nÀ faire : git diff, bash scripts/validate-gitops.sh, puis commiter ET pousser dans VOTRE dépôt (ArgoCD lit Git).")
    subprocess.run(["git", "-C", str(ROOT), "diff", "--stat"], check=False)


if __name__ == "__main__":
    main()
