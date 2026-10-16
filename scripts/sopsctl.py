#!/usr/bin/env python3
"""Gestion des secrets SOPS + age (bibliothèque standard uniquement). Voir docs/SECRETS.md.

Commandes (appelées par `task secrets:*`) :
  keys                 génère (si absentes) la clé age de l'opérateur et celle du cluster, hors repo, et renseigne
                       les recipients de .sops.yaml
  init [--all]         crée chaque <nom>.sops.yaml manquant à partir de <nom>.example.yaml (secrets/ et gitops/) :
                       valeurs aléatoires pour ce qui est générable, CHANGEME pour ce qui vient de l'extérieur.
                       Ne réécrit JAMAIS un fichier sops existant. --all inclut les secrets facultatifs.
  check [--no-decrypt] chaque example a son sops, aucun sops ne contient CHANGEME (déchiffre : clé opérateur requise),
                       aucun fichier secret en clair ni clé privée suivi par git, structure des fichiers chiffrés
  pending              liste les valeurs encore à renseigner (CHANGEME, ou vides dans secrets/site.sops.yaml), sans jamais
                       afficher de valeur
  update-keys          applique les recipients de .sops.yaml à tous les *.sops.yaml (sops updatekeys)
  oidc-sync [--from-json F]  recopie les secrets des clients OIDC (sortie `oidc_client_secrets` de la stack tofu 30-authentik, générés
                       par tofu) dans les sops de NetBird, Warpgate, Grafana et du front ; F = JSON (ou - pour stdin)
  rotate-cluster-key   nouvelle clé age du cluster : remplace le recipient, updatekeys + rotation des clés de données

Aucune valeur secrète n'est écrite sur disque en clair : tout passe par des pipes vers sops. Seule exception, la
génération de la clé SSH de déploiement (répertoire temporaire en RAM, supprimé aussitôt).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets as rnd
import shutil
import string
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOPS_CONFIG = os.environ.get("PAD_SOPS_CONFIG")  # tests : chemin d'un .sops.yaml alternatif
ALNUM = string.ascii_letters + string.digits
PLACEHOLDER_OPERATOR = "age1CHANGEMEoperatorpublickey"
PLACEHOLDER_CLUSTER = "age1CHANGEMEclusterpublickey"
CREDENTIALS = "secrets/credentials.sops.yaml"  # mots de passe en clair des valeurs stockées hachées (opérateur seul)

# Secrets facultatifs : pas créés par défaut (sans eux la plateforme fonctionne).
OPTIONAL = {"secrets/backup-s3.example.yaml"}
# Ordre de traitement : les sources des valeurs recopiées d'abord.
PRIORITY = [
    "gitops/platform/valkey/",
    "gitops/platform/zot/",
    "gitops/platform/garage/",
    "secrets/authentik.example.yaml",
    "gitops/apps/ctfd/",
    "secrets/netbird.example.yaml",
]


def die(msg: str) -> "None":
    print(f"ERREUR {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def default_operator_key() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(os.environ.get("SOPS_AGE_KEY_FILE") or Path(base) / "sops/age/keys.txt")


def default_cluster_key() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(os.environ.get("PAD_CLUSTER_AGE_KEY_FILE") or Path(base) / "pad/cluster.agekey")


def need(*tools: str) -> None:
    missing = [t for t in tools if shutil.which(t) is None]
    if missing:
        die(f"outils manquants : {' '.join(missing)} (lancer 'nix develop')")


def run(cmd: list[str], data: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.setdefault("SOPS_AGE_KEY_FILE", str(default_operator_key()))
    p = subprocess.run(cmd, input=data, capture_output=True, text=True, cwd=ROOT, env=env)
    if check and p.returncode != 0:
        # stderr de sops/age ne contient pas de valeur en clair
        die(f"{' '.join(cmd[:3])} a échoué : {p.stderr.strip()[:400]}")
    return p


def sops_cmd(*args: str) -> list[str]:
    return ["sops", *(["--config", SOPS_CONFIG] if SOPS_CONFIG else []), *args]


# ---------------------------------------------------------------- recipients (.sops.yaml)

def sops_yaml_text() -> str:
    return (ROOT / ".sops.yaml").read_text()


def require_recipients() -> None:
    if SOPS_CONFIG:
        return
    t = sops_yaml_text()
    if PLACEHOLDER_OPERATOR in t or PLACEHOLDER_CLUSTER in t:
        die("recipients CHANGEME dans .sops.yaml : lancer d'abord 'task secrets:keys'")


def age_public(keyfile: Path) -> str:
    out = run(["age-keygen", "-y", str(keyfile)]).stdout.strip().splitlines()
    return out[0]


def new_age_key(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    run(["age-keygen", "-o", str(path)])
    os.chmod(path, 0o600)


def cmd_keys(_: argparse.Namespace) -> None:
    need("age-keygen")
    op, cl = default_operator_key(), default_cluster_key()
    for label, path in (("opérateur", op), ("cluster", cl)):
        if path.exists():
            log(f"clé {label} existante : {path}")
        else:
            new_age_key(path)
            log(f"clé {label} créée : {path} (SAUVEGARDER hors machine ; ne jamais la commiter)")
    op_pub, cl_pub = age_public(op), age_public(cl)
    if op_pub == cl_pub:
        die("la clé opérateur et la clé cluster sont identiques")
    t = sops_yaml_text()
    new = t.replace(PLACEHOLDER_OPERATOR, op_pub).replace(PLACEHOLDER_CLUSTER, cl_pub)
    if new != t:
        (ROOT / ".sops.yaml").write_text(new)
        log(".sops.yaml : recipients renseignés (à commiter, ce sont des clés PUBLIQUES)")
    else:
        for label, pub in (("opérateur", op_pub), ("cluster", cl_pub)):
            if pub not in t:
                log(f"ATTENTION : la clé publique {label} {pub} n'est pas dans .sops.yaml")
    print(f"operator {op_pub}\ncluster  {cl_pub}")


# ---------------------------------------------------------------- sops

def sops_encrypt(plain: str, rel_target: str) -> str:
    return run(sops_cmd("--encrypt", "--filename-override", rel_target, "--input-type", "yaml",
                        "--output-type", "yaml", "/dev/stdin"), data=plain).stdout


def sops_decrypt_json(rel: str) -> object:
    return json.loads(run(sops_cmd("--decrypt", "--output-type", "json", rel)).stdout)


def write_new(rel: str, content: str, replace: bool = False) -> None:
    dest = ROOT / rel
    if dest.exists() and not replace:
        die(f"{rel} existe déjà : jamais réécrit")
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(content)
    os.replace(tmp, dest)


def walk_strings(node: object, path: str = ""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f"{path}.{k}" if path else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


# ---------------------------------------------------------------- générateurs

def alnum(n: int = 32) -> str:
    return "".join(rnd.choice(ALNUM) for _ in range(n))


def hexs(nbytes: int) -> str:
    return rnd.token_hex(nbytes)


def b64(nbytes: int) -> str:
    import base64
    return base64.b64encode(rnd.token_bytes(nbytes)).decode()


def bcrypt_hash(password: str) -> str:
    """Hash bcrypt ($2y$) ; le mot de passe passe par stdin, jamais par argv."""
    if shutil.which("htpasswd"):
        out = run(["htpasswd", "-niBC", "10", "x"], data=password + "\n").stdout.strip()
        return out.split(":", 1)[1]
    try:
        import bcrypt  # type: ignore
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10, b"2b")).decode()
    except ImportError:
        pass
    if shutil.which("mkpasswd"):
        return run(["mkpasswd", "-s", "-m", "bcrypt"], data=password + "\n").stdout.strip()
    die("aucun outil bcrypt (htpasswd, python bcrypt ou mkpasswd) : lancer 'nix develop'")


def sha512_crypt(password: str) -> str:
    return run(["openssl", "passwd", "-6", "-stdin"], data=password + "\n").stdout.strip()


def ssh_deploy_key() -> tuple[str, str]:
    need("ssh-keygen")
    base = "/dev/shm" if os.path.isdir("/dev/shm") else None
    d = tempfile.mkdtemp(dir=base)
    try:
        os.chmod(d, 0o700)
        key = os.path.join(d, "k")
        run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "pad-argocd-deploy", "-f", key])
        return Path(key).read_text(), Path(key + ".pub").read_text().strip()
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- substitutions dans les exemples

class SpecDrift(Exception):
    pass


def setv(text: str, key: str, value: str) -> str:
    """Remplace `key: CHANGEME` (guillemets facultatifs, commentaire final conservé) par la valeur."""
    pat = re.compile(r'^(?P<pre>[ \t]*' + re.escape(key) + r':[ \t]*)(?P<q>["\']?)CHANGEME(?P=q)(?P<post>[ \t]*(?:#.*)?)$', re.M)
    new, n = pat.subn(lambda m: m.group("pre") + json.dumps(value) + m.group("post"), text, count=1)
    if n == 0:
        raise SpecDrift(f"clé '{key}: CHANGEME' introuvable dans l'exemple")
    return new


def set_htpasswd(text: str, user: str, hashed: str) -> str:
    pat = re.compile(r'^([ \t]*' + re.escape(user) + r':)CHANGEME[ \t]*$', re.M)
    new, n = pat.subn(lambda m: m.group(1) + hashed, text, count=1)
    if n == 0:
        raise SpecDrift(f"ligne htpasswd '{user}:CHANGEME' introuvable dans l'exemple")
    return new


class Ctx:
    """Valeurs partagées entre fichiers (recopiées, jamais affichées)."""

    LOOKUPS = {
        "valkey.default": ("gitops/platform/valkey/secret.sops.yaml", "stringData.default"),
        "ctfd.PAD_SSO_SHARED_SECRET": ("gitops/apps/ctfd/secret.sops.yaml", "stringData.PAD_SSO_SHARED_SECRET"),
        "garage.access_key_id": ("gitops/platform/garage/secret-s3.sops.yaml", "stringData.access_key_id"),
        "garage.secret_access_key": ("gitops/platform/garage/secret-s3.sops.yaml", "stringData.secret_access_key"),
        "ctfd.PAD_INTERNAL_TOKEN": ("gitops/apps/ctfd/secret.sops.yaml", "stringData.PAD_INTERNAL_TOKEN"),
        "authentik.bootstrap_token": ("secrets/authentik.sops.yaml", "bootstrap_token"),
        "zot.pad_pull_password": (CREDENTIALS, "zot_pad_pull_password"),
    }

    def __init__(self, with_optional: bool = False) -> None:
        self.with_optional = with_optional
        self.vals: dict[str, str] = {}
        self.creds: dict[str, str] = {}
        self.notes: list[str] = []

    def put(self, name: str, value: str) -> str:
        self.vals[name] = value
        return value

    def get(self, name: str) -> str | None:
        if name in self.vals:
            return self.vals[name]
        rel, path = self.LOOKUPS[name]
        if not (ROOT / rel).exists():
            return None
        node: object = sops_decrypt_json(rel)
        for part in path.split("."):
            node = node[part] if isinstance(node, dict) and part in node else None  # type: ignore[index]
        if isinstance(node, str) and "CHANGEME" not in node:
            return node
        return None


def fill_ref(ctx: Ctx, text: str, key: str, name: str, fmt: str = "{}") -> str:
    v = ctx.get(name)
    if v is None:
        ctx.notes.append(f"{key} : source '{name}' indisponible, laissé à CHANGEME")
        return text
    return setv(text, key, fmt.format(v))


# --- un gestionnaire par exemple (clé = chemin relatif de l'example) ---

def h_authentik(ctx: Ctx, t: str) -> str:
    t = setv(t, "secret_key", b64(48))
    t = setv(t, "postgres_password", alnum(32))
    t = setv(t, "bootstrap_password", alnum(32))
    tok = ctx.put("authentik.bootstrap_token", alnum(64))
    return setv(t, "bootstrap_token", tok)


def h_authentik_tofu(ctx: Ctx, t: str) -> str:
    return fill_ref(ctx, t, "api_token", "authentik.bootstrap_token")


def h_edge(ctx: Ctx, t: str) -> str:
    return setv(t, "crowdsec_bouncer_key", hexs(32))


def h_deploy_key(ctx: Ctx, t: str) -> str:
    if shutil.which("ssh-keygen") is None:
        ctx.notes.append("github-deploy-key : ssh-keygen absent, clé laissée à CHANGEME")
        return t
    priv, pub = ssh_deploy_key()
    pat = re.compile(r'^([ \t]*)-----BEGIN OPENSSH PRIVATE KEY-----\n[ \t]*CHANGEME\n[ \t]*-----END OPENSSH PRIVATE KEY-----[ \t]*$', re.M)
    if not pat.search(t):
        raise SpecDrift("bloc de clé privée CHANGEME introuvable")
    t = pat.sub(lambda m: "\n".join(m.group(1) + line for line in priv.strip().splitlines()), t, count=1)
    ctx.notes.append(f"clé de déploiement GitHub créée : ajouter cette clé publique en deploy key (lecture seule) : {pub}")
    return t


def h_monitoring(ctx: Ctx, t: str) -> str:
    t = setv(t, "grafana_admin_password", alnum(32))
    t = setv(t, "grafana_secret_key", b64(32))
    return setv(t, "uptime_kuma_watchdog_token", alnum(32))


def h_netbird(ctx: Ctx, t: str) -> str:
    t = setv(t, "netbird_server_relay_auth_secret", b64(32))
    t = setv(t, "netbird_server_session_cookie_key", hexs(16))
    t = setv(t, "netbird_server_datastore_key", b64(32))
    return setv(t, "netbird_server_owner_password", alnum(32))


def h_opnsense(ctx: Ctx, t: str) -> str:
    root_pw = alnum(32)
    ctx.creds["opnsense_root_password"] = root_pw
    t = setv(t, "root_password_bcrypt", bcrypt_hash(root_pw))
    t = setv(t, "api_key", alnum(80))
    secret = alnum(80)
    t = setv(t, "api_secret", secret)
    return setv(t, "api_secret_crypt", sha512_crypt(secret))


def h_warpgate(ctx: Ctx, t: str) -> str:
    return setv(t, "warpgate_admin_password", alnum(32))


def h_garage(ctx: Ctx, t: str) -> str:
    return setv(t, "rpcSecret", hexs(32))


def h_garage_s3(ctx: Ctx, t: str) -> str:
    """Clé S3 au format Garage (GK + 24 hex, secret 64 hex), générée une fois puis recopiée dans le sops de CTFd."""
    t = setv(t, "access_key_id", ctx.put("garage.access_key_id", "GK" + hexs(12)))
    t = setv(t, "secret_access_key", ctx.put("garage.secret_access_key", hexs(32)))
    if ctx.with_optional:
        # Clé de sauvegarde dédiée (facultative) : lignes commentées dans l'exemple, activées par --all. scripts/backup.sh et
        # scripts/restore.sh l'utilisent pour le bucket `backups` quand elle est présente.
        pat = re.compile(r'^([ \t]*)#[ \t]*(backup_(?:access_key_id|secret_access_key): CHANGEME.*)$', re.M)
        if len(pat.findall(t)) != 2:
            raise SpecDrift("lignes backup_access_key_id / backup_secret_access_key (commentées) introuvables")
        t = pat.sub(lambda m: m.group(1) + m.group(2), t)
        t = setv(t, "backup_access_key_id", "GK" + hexs(12))
        t = setv(t, "backup_secret_access_key", hexs(32))
        ctx.notes.append("clé S3 de sauvegarde dédiée créée : seule elle accède au bucket backups (Job garage-init) ;"
                         " scripts/backup.sh et restore.sh l'utilisent automatiquement")
    if (ROOT / "gitops/apps/ctfd/secret.sops.yaml").exists():
        ctx.notes.append("clé S3 Garage générée alors que gitops/apps/ctfd/secret.sops.yaml existe déjà : y recopier"
                         " AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (sops) pour qu'ils soient identiques")
    return t


def h_valkey(ctx: Ctx, t: str) -> str:
    return setv(t, "default", ctx.put("valkey.default", alnum(32)))


def h_zot(ctx: Ctx, t: str) -> str:
    for user, cred in (("admin", "zot_admin_password"), ("pad-ci", "zot_pad_ci_password"),
                       ("pad-pull", "zot_pad_pull_password"), ("metrics", None)):
        pw = alnum(32)
        if cred:
            ctx.creds[cred] = pw
        else:
            ctx.put("zot.metrics_password", pw)
        t = set_htpasswd(t, user, bcrypt_hash(pw))
    ctx.vals["zot.pad_pull_password"] = ctx.creds["zot_pad_pull_password"]
    return t


def h_zot_metrics(ctx: Ctx, t: str) -> str:
    pw = ctx.vals.get("zot.metrics_password")
    if pw is None:
        ctx.notes.append("zot metrics : mot de passe de secret.sops.yaml indisponible (fichier déjà existant), laissé à CHANGEME ;"
                         " le recopier depuis zot-htpasswd ou régénérer les deux fichiers")
        return t
    return setv(t, "password", pw)


def h_ctfd(ctx: Ctx, t: str) -> str:
    t = setv(t, "SECRET_KEY", hexs(32))
    t = setv(t, "DATABASE_PASSWORD", alnum(32))
    t = setv(t, "MARIADB_ROOT_PASSWORD", alnum(32))
    t = fill_ref(ctx, t, "REDIS_PASSWORD", "valkey.default")
    t = setv(t, "PAD_SSO_SHARED_SECRET", ctx.put("ctfd.PAD_SSO_SHARED_SECRET", alnum(48)))
    # Clé S3 Garage : mêmes valeurs que gitops/platform/garage/secret-s3 (importées par le Job garage-init).
    t = fill_ref(ctx, t, "AWS_ACCESS_KEY_ID", "garage.access_key_id")
    t = fill_ref(ctx, t, "AWS_SECRET_ACCESS_KEY", "garage.secret_access_key")
    # Jeton interne partagé avec netbird-sync (lecture des membres d'équipe) : généré ici, recopié dans son sops.
    t = setv(t, "PAD_INTERNAL_TOKEN", ctx.put("ctfd.PAD_INTERNAL_TOKEN", alnum(48)))
    return setv(t, "PAD_METRICS_TOKEN", alnum(48))


def h_netbird_sync(ctx: Ctx, t: str) -> str:
    # NETBIRD_API_URL et NETBIRD_API_TOKEN (PAT du service user) restent à renseigner à la main.
    return fill_ref(ctx, t, "PAD_INTERNAL_TOKEN", "ctfd.PAD_INTERNAL_TOKEN")


def h_chall_manager(ctx: Ctx, t: str) -> str:
    pw = ctx.get("zot.pad_pull_password")
    if pw is None:
        ctx.notes.append("chall-manager-oci : mot de passe pad-pull de Zot indisponible, laissé à CHANGEME")
        return t
    return setv(setv(t, "username", "pad-pull"), "password", pw)


def h_frontend(ctx: Ctx, t: str) -> str:
    t = setv(t, "AUTH_SECRET", alnum(48))
    # Une seule valeur pour le front et CTFd (le front vérifie les jetons SSO signés par le bridge CTFd).
    sso = ctx.get("ctfd.PAD_SSO_SHARED_SECRET")
    if sso is None:
        sso = alnum(48)
        ctx.notes.append("frontend : secret SSO partagé généré mais ctfd/secret.sops.yaml absent ; l'y copier (même valeur requise)")
    t = setv(t, "PAD_SSO_SHARED_SECRET", sso)
    t = fill_ref(ctx, t, "VALKEY_URL", "valkey.default", "redis://:{}@valkey.storage.svc.cluster.local:6379")
    return setv(t, "METRICS_TOKEN", alnum(48))


HANDLERS = {
    "secrets/authentik.example.yaml": h_authentik,
    "secrets/authentik-tofu.example.yaml": h_authentik_tofu,
    "secrets/edge.example.yaml": h_edge,
    "secrets/github-deploy-key.example.yaml": h_deploy_key,
    "secrets/monitoring.example.yaml": h_monitoring,
    "secrets/netbird.example.yaml": h_netbird,
    "secrets/opnsense.example.yaml": h_opnsense,
    "secrets/warpgate.example.yaml": h_warpgate,
    "gitops/platform/garage/secret-rpc.example.yaml": h_garage,
    "gitops/platform/garage/secret-s3.example.yaml": h_garage_s3,
    "gitops/platform/valkey/secret.example.yaml": h_valkey,
    "gitops/platform/zot/secret.example.yaml": h_zot,
    "gitops/platform/zot/secret-metrics.example.yaml": h_zot_metrics,
    "gitops/apps/ctfd/secret.example.yaml": h_ctfd,
    "gitops/apps/chall-manager/secret.example.yaml": h_chall_manager,
    "gitops/apps/frontend/secret.example.yaml": h_frontend,
    "gitops/apps/netbird-sync/secret.example.yaml": h_netbird_sync,
}
# Exemples sans valeur générable (jeton Proxmox, OVH, Discord, SMTP, PAT NetBird...) : chiffrés tels quels, CHANGEME à
# renseigner à la main (liste affichée par `task secrets:pending`).
EXTERNAL_ONLY = {
    "secrets/ovh.example.yaml", "secrets/proxmox.example.yaml", "secrets/site.example.yaml", "secrets/netbird-tofu.example.yaml",
    "secrets/warpgate-tofu.example.yaml", "secrets/backup-s3.example.yaml",
    "gitops/platform/external-dns/secret.example.yaml", "gitops/platform/proxmox-csi/secret.example.yaml",
    "gitops/platform/cert-manager/resources/ovh-credentials.example.yaml",
}


def find_examples() -> list[str]:
    found = [str(p.relative_to(ROOT)) for p in sorted(ROOT.glob("secrets/*.example.yaml"))]
    for p in sorted((ROOT / "gitops").rglob("*.example.yaml")):
        if "node_modules" not in p.parts:
            found.append(str(p.relative_to(ROOT)))
    return found


def sops_of(example: str) -> str:
    return example[: -len(".example.yaml")] + ".sops.yaml"


def sort_key(rel: str) -> tuple[int, int, str]:
    # secret-metrics (zot) après secret : il recopie le mot de passe généré avec le htpasswd.
    late = 1 if rel.endswith("secret-metrics.example.yaml") else 0
    for i, prefix in enumerate(PRIORITY):
        if rel.startswith(prefix):
            return (i, late, rel)
    return (len(PRIORITY), late, rel)


def cmd_init(args: argparse.Namespace) -> None:
    need("sops", "age-keygen", "openssl")
    require_recipients()
    ctx = Ctx(with_optional=args.all)
    created: list[str] = []
    for ex in sorted(find_examples(), key=sort_key):
        target = sops_of(ex)
        if (ROOT / target).exists():
            log(f"= {target} existe, conservé")
            continue
        if ex in OPTIONAL and not args.all:
            log(f"- {target} facultatif, ignoré (--all pour le créer)")
            continue
        text = (ROOT / ex).read_text()
        handler = HANDLERS.get(ex)
        try:
            if handler:
                text = handler(ctx, text)
            elif ex not in EXTERNAL_ONLY:
                ctx.notes.append(f"{ex} : aucune règle de génération, toutes les valeurs restent à CHANGEME")
        except SpecDrift as e:
            die(f"{ex} : {e} (exemple modifié sans mettre à jour scripts/sopsctl.py)")
        write_new(target, sops_encrypt(text, target))
        created.append(target)
        log(f"+ {target}")
    if ctx.creds:
        merge_credentials(ctx.creds)
    for n in ctx.notes:
        log(f"note : {n}")
    log(f"{len(created)} fichier(s) créé(s).")
    if created:
        report_pending(created)


def merge_credentials(new: dict[str, str]) -> None:
    existing: dict[str, str] = {}
    if (ROOT / CREDENTIALS).exists():
        existing = dict(sops_decrypt_json(CREDENTIALS))  # type: ignore[arg-type]
    added = {k: v for k, v in new.items() if k not in existing}
    if not added:
        return
    existing.update(added)
    plain = "# Mots de passe en clair des valeurs stockées hachées ailleurs (opérateur seul).\n" + "".join(
        f"{k}: {json.dumps(v)}\n" for k, v in existing.items())
    write_new(CREDENTIALS, sops_encrypt(plain, CREDENTIALS), replace=True)
    log(f"+ {CREDENTIALS} ({', '.join(added)})")


# ---------------------------------------------------------------- pending / check

# Valeurs de site (secrets/site.sops.yaml) : l'exemple les laisse vides, donc « à renseigner » = clé requise encore vide.
SITE_SOPS = "secrets/site.sops.yaml"
SITE_REQUIRED = ("proxmox_url", "ssh_host", "ssh_user", "wan.ip")


def wan_mode() -> str:
    m = re.search(r"^wan:\n(?:[ \t]+.*\n|[ \t]*\n|[ \t]*#.*\n)*?[ \t]+mode:[ \t]*([a-z_]+)", (ROOT / "infra/contracts.yaml").read_text(), re.M)
    return m.group(1) if m else ""


def pending_in(rel: str) -> list[str]:
    data = sops_decrypt_json(rel)
    keys = [p for p, v in walk_strings(data) if "CHANGEME" in v]
    if rel == SITE_SOPS:
        required = SITE_REQUIRED + (("wan.gateway",) if wan_mode() == "routed_ip" else ())
        values = dict(walk_strings(data))
        keys += [k for k in required if not values.get(k, "").strip()]
    return keys


def all_sops_files() -> list[str]:
    out = []
    for base in ("secrets", "gitops"):
        for p in sorted((ROOT / base).rglob("*.sops.yaml")):
            out.append(str(p.relative_to(ROOT)))
    return out


def report_pending(files: list[str]) -> int:
    n = 0
    for f in files:
        keys = pending_in(f)
        if keys:
            n += len(keys)
            print(f"A RENSEIGNER {f} : {', '.join(keys)}   (sops {f})")
    if n == 0:
        print("Plus aucune valeur CHANGEME.")
    return n


def cmd_pending(_: argparse.Namespace) -> None:
    need("sops")
    sys.exit(1 if report_pending(all_sops_files()) else 0)


def git_files() -> list[str]:
    p = run(["git", "ls-files"], check=False)
    return p.stdout.splitlines() if p.returncode == 0 else []


FORBIDDEN_NAME = re.compile(r'(^|/)(keys\.txt|[^/]*\.agekey|[^/]*\.decrypted\.[^/]*|[^/]*\.dec\.(ya?ml|json))$')


def cmd_check(args: argparse.Namespace) -> None:
    errors: list[str] = []
    if not SOPS_CONFIG and (PLACEHOLDER_OPERATOR in sops_yaml_text() or PLACEHOLDER_CLUSTER in sops_yaml_text()):
        errors.append(".sops.yaml : recipients encore à CHANGEME (task secrets:keys)")
    for ex in find_examples():
        if ex in OPTIONAL:
            continue
        if not (ROOT / sops_of(ex)).exists():
            errors.append(f"{sops_of(ex)} manquant (task secrets:init)")
    tracked = git_files()
    for f in tracked:
        if FORBIDDEN_NAME.search(f):
            errors.append(f"{f} : fichier de clé ou déchiffré suivi par git")
    for f in tracked:
        pth = ROOT / f
        if pth.is_file() and pth.stat().st_size < 2_000_000:
            try:
                if "AGE-SECRET-KEY-" in pth.read_text(errors="ignore") and f not in ("scripts/sopsctl.py", "scripts/check-sops.sh", ".gitleaks.toml"):
                    errors.append(f"{f} : clé privée age en clair")
            except OSError:
                pass
    guard = subprocess.run([str(ROOT / "scripts/check-sops.sh")], cwd=ROOT, capture_output=True, text=True)
    if guard.returncode != 0:
        errors.extend(guard.stdout.strip().splitlines() + guard.stderr.strip().splitlines())
    if not args.no_decrypt:
        need("sops")
        for f in all_sops_files():
            try:
                keys = pending_in(f)
            except SystemExit:
                errors.append(f"{f} : déchiffrement impossible (clé opérateur ?)")
                continue
            if keys:
                errors.append(f"{f} : CHANGEME dans {', '.join(keys)}")
    for e in errors:
        print(f"KO {e}")
    print("secrets:check " + ("ECHEC" if errors else "OK"))
    sys.exit(1 if errors else 0)


# ---------------------------------------------------------------- recipients : mise à jour / rotation

def cmd_update_keys(_: argparse.Namespace) -> None:
    need("sops")
    require_recipients()
    files = all_sops_files()
    for f in files:
        run(sops_cmd("updatekeys", "--yes", f))
        log(f"updatekeys {f}")
    log(f"{len(files)} fichier(s) à jour.")


def cmd_rotate_cluster_key(_: argparse.Namespace) -> None:
    need("sops", "age-keygen")
    require_recipients()
    cl = default_cluster_key()
    if not cl.exists():
        die(f"clé cluster introuvable : {cl}")
    old_pub = age_public(cl)
    backup = cl.with_name(cl.name + "." + datetime.now().strftime("%Y%m%d%H%M%S") + ".old")
    shutil.copy2(cl, backup)
    cl.unlink()
    new_age_key(cl)
    new_pub = age_public(cl)
    t = sops_yaml_text()
    if old_pub not in t:
        die("l'ancienne clé publique du cluster n'est pas dans .sops.yaml")
    (ROOT / ".sops.yaml").write_text(t.replace(old_pub, new_pub))
    for f in all_sops_files():
        if f.startswith("gitops/"):
            run(sops_cmd("updatekeys", "--yes", f))
            run(sops_cmd("rotate", "--in-place", f))  # nouvelle clé de données
            log(f"rotation {f}")
    log(f"ancienne clé conservée : {backup} (la détruire une fois le cluster migré)")
    log("Suite : commiter .sops.yaml et gitops/**/*.sops.yaml, puis 'task bootstrap:gitops' (réinjecte sops-age).")
    log("Si l'ancienne clé a fuité, changer aussi les VALEURS des secrets (l'historique Git contient l'ancien chiffrement).")


# ---------------------------------------------------------------- secrets des clients OIDC (générés par tofu 30-authentik)

OIDC_STACK = "infra/tofu/stacks/30-authentik"
# client du contrat -> (fichier sops, clé). Les autres clients (argocd, proxmox) restent manuels (docs/operations).
OIDC_TARGETS = {
    "netbird": ("secrets/netbird.sops.yaml", "netbird_server_authentik_client_secret"),
    "warpgate": ("secrets/warpgate.sops.yaml", "warpgate_sso_client_secret"),
    "grafana": ("secrets/monitoring.sops.yaml", "grafana_oidc_client_secret"),
    "frontend": ("gitops/apps/frontend/secret.sops.yaml", "AUTH_AUTHENTIK_SECRET"),
}


def sops_set_value(rel: str, key: str, value: str) -> bool:
    """Remplace la valeur de `key` dans un sops (déchiffre en mémoire, ré-chiffre par pipe). Retourne True si modifié."""
    plain = run(sops_cmd("--decrypt", "--output-type", "yaml", rel)).stdout
    pat = re.compile(r'^(?P<pre>[ \t]*' + re.escape(key) + r':[ \t]*)(?P<val>[^\n#]*?)(?P<post>[ \t]*(?:#.*)?)$', re.M)
    m = pat.search(plain)
    if not m:
        die(f"{rel} : clé '{key}' introuvable")
    if m.group("val").strip().strip("\"'") == value:
        return False
    plain = plain[: m.start()] + m.group("pre") + json.dumps(value) + m.group("post") + plain[m.end():]
    write_new(rel, sops_encrypt(plain, rel), replace=True)
    return True


def cmd_oidc_sync(args: argparse.Namespace) -> None:
    need("sops")
    require_recipients()
    if args.from_json:
        raw = sys.stdin.read() if args.from_json == "-" else Path(args.from_json).read_text()
    else:
        need("tofu")
        raw = run(["tofu", f"-chdir={ROOT / OIDC_STACK}", "output", "-json", "oidc_client_secrets"]).stdout
    try:
        by_client = json.loads(raw)
    except json.JSONDecodeError:
        die("sortie oidc_client_secrets illisible (stack 30-authentik appliquée ?)")
    done = 0
    for client, (rel, key) in OIDC_TARGETS.items():
        value = by_client.get(client) if isinstance(by_client, dict) else None
        if not isinstance(value, str) or not value:
            die(f"secret du client OIDC '{client}' absent de la sortie tofu")
        if not (ROOT / rel).exists():
            die(f"{rel} absent (task secrets:init)")
        changed = sops_set_value(rel, key, value)
        done += 1
        log(f"{'+' if changed else '='} {rel} : {key} {'mis à jour' if changed else 'inchangé'}")
    log(f"{done} secret(s) de client OIDC synchronisé(s). Restent manuels : argocd (argocd-oidc) et proxmox (realm OpenID).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keys").set_defaults(fn=cmd_keys)
    p = sub.add_parser("init")
    p.add_argument("--all", action="store_true")
    p.set_defaults(fn=cmd_init)
    p = sub.add_parser("check")
    p.add_argument("--no-decrypt", action="store_true")
    p.set_defaults(fn=cmd_check)
    sub.add_parser("pending").set_defaults(fn=cmd_pending)
    sub.add_parser("update-keys").set_defaults(fn=cmd_update_keys)
    p = sub.add_parser("oidc-sync")
    p.add_argument("--from-json", metavar="FICHIER", help="JSON {client: secret} au lieu de `tofu output` (- = stdin)")
    p.set_defaults(fn=cmd_oidc_sync)
    sub.add_parser("rotate-cluster-key").set_defaults(fn=cmd_rotate_cluster_key)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
