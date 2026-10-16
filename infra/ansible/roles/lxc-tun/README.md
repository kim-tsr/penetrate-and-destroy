# Rôle lxc-tun

Ajoute `/dev/net/tun` aux LXC non privilégiés du contrat marqués `tun: true` (`warpgate`, `nbrouter`), requis par l'agent NetBird (WireGuard).

S'exécute sur l'**hôte Proxmox** (`pct`, sudo). Pourquoi pas tofu : l'API Proxmox réserve `devN` à `root@pam`, un jeton `pad@pve` ne peut pas le poser (le module `lxc-service` ignore donc `device_passthrough`). Pourquoi pas `/etc/pve/lxc/<vmid>.conf` à la main : `pct set --dev0 /dev/net/tun,mode=0666` est la voie supportée et idempotente.

- Lit `pct config <vmid>` ; n'agit que si le périphérique manque ; refuse d'écraser un autre `dev0`.
- Redémarre le LXC modifié (`pct reboot`, ou `pct start` s'il est arrêté) : un conteneur déjà conforme n'est jamais redémarré.
- Joué avec l'agent : `task ansible:services -- --tags netbird-agent`.
