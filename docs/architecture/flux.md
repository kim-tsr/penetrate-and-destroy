# Matrice de flux

OPNsense applique un **deny all par défaut, journalisé**. Seuls les flux ci-dessous sont autorisés. Ils sont
déclarés dans la stack OpenTofu `60-opnsense-rules`, à partir des ports du contrat (`flow_ports`), et jamais saisis
à la main dans l'interface.

## Règles

| Réf. | Source | Destination | Ports | Pourquoi |
|---|---|---|---|---|
| M1 | Internet | `edge` (DMZ), `netbird` (DMZ) | 443/tcp, 80/tcp ; 3478/udp et plage TURN | seule exposition publique |
| M2 | `edge` | ingress du cluster (`10.20.60.200`) | 80, 443 | proxy vers le front et CTFd |
| M3 | `edge` | `authentik` (IDENTITY) | 443 | proxy vers l'IdP |
| M5 | staff NetBird (LXC `netbird`) | `warpgate` (BASTION) | 2222, 8888 | le staff n'atteint que le bastion |
| M6 | BASTION | toutes les zones | 22, 443, 6443, 50000 | SSH, HTTPS, API Kubernetes, API Talos ; plus SSH/GUI d'OPNsense |
| M7 | toutes les zones | `monitoring` | 8428, 3100, 4317, 4318 | push uniquement (remote_write, Loki, OTLP) |
| M8 | `monitoring` | toutes les zones | 9000-9999, 10249, 10250, 12345 | scrape uniquement |
| M9 | PROD | API Proxmox (`10.20.10.2:8006`) | 8006 | CAPMOX et CSI |
| M10 | workers CHALLENGES (6443) ; zone CHALLENGES (DNS) | API Kubernetes ; DNS interne | 6443, 53 | l'API kube n'est ouverte qu'aux IP des workers (ni routing peer NetBird, ni IP d'instances) ; egress Internet par allowlist |
| I1 | toutes les zones | OPNsense | 53 | DNS Unbound |
| I2 | toutes les zones | `edge` | 443 | split-DNS : les noms publics (`auth`, `vpn`, `front`, `status`) résolvent vers l'IP interne de l'edge (overrides Unbound), qui relaie vers authentik (M3) ; back-channel OIDC |
| I3 | nœuds Kubernetes PROD et CHALLENGES, **asymétrique** | nœuds Kubernetes de l'autre zone | PROD vers CHALLENGES : kubelet 10250 (control plane seul), Cilium health 4240 et Hubble 4244, VXLAN 8472, WireGuard 51871. CHALLENGES vers PROD : trustd 50001 (control plane seul), Cilium health 4240, VXLAN 8472, WireGuard 51871 | cluster étendu sur deux zones ; un worker challenges compromis n'atteint ni kubelet ni apid du control plane (apid : bastion seul, M6) |
| I4 | `edge` | `monitoring` | 3001 | page de statut Uptime Kuma |
| I5 | zones listées | Internet (hors plages privées) | 80, 443, 123/udp | mises à jour, ACME ; activable par zone |

M1 ne fait qu'autoriser le trafic : la redirection de ports WAN (DNAT vers `edge` et `netbird`) est posée par le
`config.xml` de bootstrap (stack `10-router`), sans règle de filtre associée, car l'API `d_nat` n'existe qu'à partir
d'OPNsense 26.1. Changer `wan.public_ports` impose de réimporter la configuration
(`tofu apply -replace=module.opnsense.proxmox_virtual_environment_vm.this` dans `10-router`).

Les joueurs ne sont pas dans cette table : ils atteignent les instances **par NetBird**, dont les policies sont
créées dynamiquement par `netbird-sync`. Voir [Cycle de vie d'une instance](instances.md).

## Routing peers

Deux routing peers NetBird, un par zone, pour que la règle « CHALLENGES vers rien » reste vraie :

| Peer | Zone | Network NetBird | Qui y accède |
|---|---|---|---|
| challenges (LXC `nbrouter`, `10.20.70.10`) | CHALLENGES | `pad-instances` | joueurs, uniquement vers les IP d'instances de leur équipe |
| bastion (LXC `warpgate`) | BASTION | `pad-bastion` | staff, uniquement vers le bastion |

Le routing peer est en masquerade : les cibles voient l'IP du routing peer. Le trafic vers les IP d'instances reste dans la
zone CHALLENGES (aucune règle). Les règles `N1` à `N6` de `60-opnsense-rules` ne couvrent que la sortie des deux routing peers
vers le management/relay (HTTPS), STUN (UDP 3478), le WireGuard direct entre pairs (UDP 1024-65535, désactivable par
`netbird_routers_direct_udp`) et, pour `nbrouter`, apt et NTP. Enrôlement : rôle `netbird-agent`, voir
[NetBird](../composants/netbird.md).

## Refus journalisés

Tout paquet refusé est journalisé par OPNsense. La collecte de ces blocages dans Loki (syslog) fait partie des
[limites connues](../reference/limites.md). Pour diagnostiquer un refus, voir le
[runbook d'incident](../runbooks/incident.md).

## Vérifier la matrice

`task verify` contrôle l'isolement de CHALLENGES vers IDENTITY. Une validation complète consiste à lancer `nmap`
depuis chaque zone et à comparer avec ce tableau.
