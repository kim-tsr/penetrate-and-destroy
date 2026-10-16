# Rôle netbird-agent

Agent NetBird d'un **routing peer** : un par zone (matrice de flux), jamais un seul.

| Zone | Hôte | Groupe NetBird | Network |
|---|---|---|---|
| CHALLENGES | LXC `nbrouter` (`services.nbrouter`, `netbird.routing_peer_ip`) | `pad-routers-challenges` | `pad-instances` |
| BASTION | LXC `warpgate` (`netbird.bastion_routing_peer_ip`) | `pad-routers-bastion` | `pad-bastion` |

## Ce que fait le rôle

1. Charge `secrets/netbird-agent.sops.yaml` (setup keys, recopiées de la stack tofu `40-netbird` par `task netbird:sync-keys`) et refuse une clé vide ou `CHANGEME`.
2. Exige `/dev/net/tun` (posé sur l'hôte par le rôle `lxc-tun`), installe `nftables` et `iptables` (masquerade de l'agent), le paquet apt `netbird` en version épinglée (`pad_apt_versions.netbird`, gelée avec `dpkg hold`) et active `net.ipv4.ip_forward`.
3. Lit `netbird status --json` ; **n'exécute `netbird up --setup-key ... --management-url ...` que si le management ou le signal n'est pas connecté** (rejouable sans réenregistrer le pair), puis attend la connexion.

Le masquerade lui-même est demandé au serveur : `netbird_network_router` (stack 40) a `masquerade = true`, l'agent le programme dans nftables. Les instances voient donc l'IP du routing peer CHALLENGES (`PAD_FROM_CIDRS`).

## Utilisation

Joué par la phase 11, jamais par défaut (tag `never`) : `task ansible:services -- --tags netbird-agent`. Variable du play : `netbird_agent_zone` (`challenges` ou `bastion`).

## Limites

- La clé passe en argument de `netbird up` : elle est visible dans `ps` le temps de la commande, sur un LXC où seul root se connecte.
- Clé expirée ou épuisée après une reconstruction : `task netbird:rotate-keys`. Un pair déjà enrôlé n'a plus besoin de la clé.
- Version du paquet apt (`0.81.0`) et nom du service systemd (`netbird`) non vérifiés contre le dépôt `pkgs.netbird.io` depuis l'environnement de développement.
