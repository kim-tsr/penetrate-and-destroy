#!/usr/bin/env python3
"""Pilote l'importer de configuration d'OPNsense par la console SÉRIE de la VM (exécuté sur l'hôte Proxmox, root).

L'image nano d'OPNsense démarre en « Dual Console: Serial Primary, Video Secondary » : le prompt de l'importer
(« Press any key to start the configuration importer », puis « Select device to import from ») n'écoute que la
console série. On se connecte donc au socket série de QEMU, on redémarre la VM pour être sûr de voir le prompt,
puis on répond au texte réellement affiché, au lieu de taper à l'aveugle sur le clavier VGA.

Repli : si le login est atteint sans prompt d'importer (une config d'usine a déjà été écrite au 1er boot, l'importer
est alors sauté), on se connecte en root avec le mot de passe d'usine, on monte le CD et on copie /conf/config.xml,
puis on redémarre. Ce repli n'agit que sur une config d'usine (le mot de passe root d'usine y est encore valable).

Usage : python3 serial-import.py <vmid> [device] [timeout_s]   (lu sur stdin par import-config.sh via SSH + sudo)
Sortie 0 quand l'import a été demandé et que le boot a repris ; sinon 1 avec la fin de la console.
"""
import os
import socket
import subprocess
import sys
import time

vmid = sys.argv[1]
device = sys.argv[2] if len(sys.argv) > 2 else "cd0"
timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 600
path = f"/var/run/qemu-server/{vmid}.serial0"

deadline = time.time() + 120
while not os.path.exists(path):
    if time.time() > deadline:
        sys.exit(f"socket série introuvable : {path} (la VM a-t-elle un serial0 de type socket ?)")
    time.sleep(2)

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect(path)
sock.settimeout(1.0)

print(f"Console série de la VM {vmid} ouverte ; redémarrage pour capter le prompt de l'importer", flush=True)
subprocess.run(["qm", "reset", vmid], check=True)

FACTORY_PASSWORD = "opnsense"  # mot de passe root d'une config d'usine OPNsense (remplacé par le config.xml importé)
MARK = "PAD_IMP0RT_0K"  # produit par `tr` : n'apparaît pas dans l'écho de la commande tapée


def send(data: str) -> None:
    sock.sendall(data.encode())


buf = ""
state = "wait_key"  # wait_key -> wait_device -> wait_boot ; repli : login -> password -> menu -> shell -> copied
end = time.time() + timeout
while time.time() < end:
    try:
        chunk = sock.recv(4096)
    except socket.timeout:
        chunk = b""
    if chunk:
        buf = (buf + chunk.decode("utf-8", "replace"))[-8000:]
    low = buf.lower()
    if state == "wait_key" and "configuration importer" in low:
        print("prompt de l'importer vu : appui sur une touche", flush=True)
        send(" ")
        state, buf = "wait_device", ""
    elif state == "wait_device" and "select device" in low:
        print(f"choix du périphérique : {device}", flush=True)
        send(device + "\r")
        state, buf = "wait_boot", ""
    elif state == "wait_boot" and "login:" in low:
        print("import demandé, démarrage terminé (prompt de login atteint)", flush=True)
        sys.exit(0)
    elif state in ("wait_key", "wait_device") and low.rstrip().endswith("login:"):
        print("pas de prompt d'importer (config d'usine déjà écrite) : copie depuis le CD en root", flush=True)
        send("root\r")
        state, buf = "password", ""
    elif state == "password" and "password:" in low:
        send(FACTORY_PASSWORD + "\r")
        state, buf = "menu", ""
    elif state == "menu" and "login incorrect" in low:
        # Mot de passe d'usine refusé : la config de la plateforme (seule source possible : l'ISO) est déjà en place.
        print("configuration déjà importée (mot de passe root d'usine refusé) : rien à faire", flush=True)
        sys.exit(0)
    elif state == "menu" and "enter an option" in low:
        send("8\r")  # shell
        state, buf = "shell", ""
    elif state == "shell" and ("# " in buf or "root@" in low):
        time.sleep(1)
        send(f"mount_cd9660 /dev/{device} /mnt && cp /mnt/conf/config.xml /conf/config.xml && umount /mnt"
             " && echo PAD_IMPORT_OK | tr O 0 && reboot\r")
        state, buf = "copied", ""
    elif state == "copied" and MARK in buf:
        print("config.xml copié depuis le CD ; redémarrage avec la configuration de la plateforme", flush=True)
        state, buf = "wait_boot", ""

print(f"échec (état {state}) ; fin de la console série :\n{buf[-2000:]}", file=sys.stderr)
sys.exit(1)
