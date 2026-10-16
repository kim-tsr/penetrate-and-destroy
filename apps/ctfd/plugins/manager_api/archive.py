"""Lecture sûre d'une archive ZIP de challenge (en mémoire, sans extraction disque).

Protections :
- taille de l'archive, nombre d'entrées, taille par fichier et totale
  décompressées (zip bomb), mesurées sur les octets réellement lus et non sur
  les en-têtes, falsifiables ;
- zip-slip : chemins absolus, `..`, antislash, octets nuls, lecteurs Windows,
  liens symboliques refusés. Rien n'est écrit sur le disque ici : les chemins
  ne servent qu'à retrouver les fichiers cités par `challenge.yml`.
"""

import io
import posixpath
import stat
import zipfile

from CTFd.plugins.pad_common.settings import setting_int

CHALLENGE_FILE = "challenge.yml"


class ArchiveError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def limits():
    return {
        "max_zip": setting_int("PAD_IMPORT_MAX_ZIP_BYTES", 50 * 1024 * 1024),
        "max_entries": setting_int("PAD_IMPORT_MAX_ENTRIES", 200),
        "max_file": setting_int("PAD_IMPORT_MAX_FILE_BYTES", 100 * 1024 * 1024),
        "max_total": setting_int("PAD_IMPORT_MAX_TOTAL_BYTES", 200 * 1024 * 1024),
        "max_yaml": setting_int("PAD_IMPORT_MAX_YAML_BYTES", 256 * 1024),
        "max_ratio": setting_int("PAD_IMPORT_MAX_RATIO", 200),
    }


def safe_path(name):
    """Normalise un chemin d'archive ou lève ArchiveError (zip-slip)."""
    if not name or "\x00" in name or "\\" in name or name.startswith("/"):
        raise ArchiveError(422, f"Unsafe path in archive: {name!r}")
    if len(name) > 1 and name[1] == ":":
        raise ArchiveError(422, f"Unsafe path in archive: {name!r}")
    norm = posixpath.normpath(name)
    parts = norm.split("/")
    if norm in ("", ".") or ".." in parts or norm.startswith("/"):
        raise ArchiveError(422, f"Unsafe path in archive: {name!r}")
    return norm


def _read_bounded(zf, info, cap):
    out = bytearray()
    with zf.open(info) as fh:
        while True:
            chunk = fh.read(64 * 1024)
            if not chunk:
                break
            out += chunk
            if len(out) > cap:
                raise ArchiveError(
                    413, f"Entry too large once decompressed: {info.filename}"
                )
    return bytes(out)


def read_archive(raw):
    """Retourne (yaml_bytes, {chemin_relatif: bytes}) depuis les octets du ZIP."""
    lim = limits()
    if len(raw) > lim["max_zip"]:
        raise ArchiveError(413, "Archive too large")
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ArchiveError(400, "Not a valid ZIP archive")
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        if len(zf.infolist()) > lim["max_entries"]:
            raise ArchiveError(413, "Too many entries in archive")
        if sum(i.file_size for i in infos) > lim["max_total"]:
            raise ArchiveError(413, "Archive too large once decompressed")

        entries = {}
        for info in infos:
            path = safe_path(info.filename)
            mode = info.external_attr >> 16
            if mode and stat.S_ISLNK(mode):
                raise ArchiveError(422, f"Symlink not allowed: {info.filename}")
            if info.flag_bits & 0x1:
                raise ArchiveError(422, "Encrypted entries are not supported")
            if path in entries:
                raise ArchiveError(422, f"Duplicate entry: {path}")
            if (
                info.compress_size
                and info.file_size > 1024 * 1024
                and info.file_size / info.compress_size > lim["max_ratio"]
            ):
                raise ArchiveError(413, f"Suspicious compression ratio: {path}")
            entries[path] = info

        # challenge.yml à la racine, ou dans l'unique dossier racine.
        roots = {p.split("/", 1)[0] for p in entries if "/" in p}
        prefix = ""
        if CHALLENGE_FILE not in entries:
            top = [p for p in entries if p == f"{next(iter(roots), '')}/{CHALLENGE_FILE}"]
            if len(roots) == 1 and top:
                prefix = next(iter(roots)) + "/"
            else:
                raise ArchiveError(422, f"{CHALLENGE_FILE} not found in archive")

        total = 0
        files = {}
        yaml_bytes = None
        for path, info in entries.items():
            if not path.startswith(prefix):
                continue
            rel = path[len(prefix):]
            cap = lim["max_yaml"] if rel == CHALLENGE_FILE else lim["max_file"]
            data = _read_bounded(zf, info, cap)
            total += len(data)
            if total > lim["max_total"]:
                raise ArchiveError(413, "Archive too large once decompressed")
            if rel == CHALLENGE_FILE:
                yaml_bytes = data
            else:
                files[rel] = data
    return yaml_bytes, files
