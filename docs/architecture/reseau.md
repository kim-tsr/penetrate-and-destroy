# Réseau et zones

## Bridges

| Bridge | Rôle |
|---|---|
| `vmbr0` | WAN. Porte l'IP publique de l'hôte ; la VM OPNsense y branche son interface WAN |
| `vmbr2` | bridge **VLAN-aware sans uplink** : trunk des zones, uniquement routé par OPNsense |
| `vmbr1` | transit, seulement en mode WAN `nat` (voir ci-dessous) |

## Zones

Source : `zones` dans `infra/contracts.yaml`. Chaque zone a la passerelle `.1` de son CIDR, portée par OPNsense,
qui est aussi le résolveur DNS (Unbound) de la zone.

| VLAN | Zone | CIDR | Contenu |
|---|---|---|---|
| 10 | MGMT | `10.20.10.0/24` | interface d'admin OPNsense, hôte Proxmox (`10.20.10.2`), CI éventuelle |
| 20 | DMZ | `10.20.20.0/24` | LXC `edge` (`.10`), LXC `netbird` (`.11`) |
| 30 | BASTION | `10.20.30.0/24` | LXC `warpgate` (`.10`) |
| 40 | IDENTITY | `10.20.40.0/24` | LXC `authentik` (`.10`) |
| 50 | MONITORING | `10.20.50.0/24` | LXC `monitoring` (`.10`) |
| 60 | PROD | `10.20.60.0/24` | VIP Talos (`.5`), control plane, workers `platform`, pool LB d'ingress (`.200` à `.220`) |
| 70 | CHALLENGES | `10.20.70.0/24` | workers `challenges`, LXC `nbrouter` = routing peer NetBird (`.10`), pool LB des instances (`.100` à `.199`) |

Réseaux internes du cluster : pods `10.244.0.0/16`, services `10.96.0.0/12`. Overlay NetBird : `100.64.0.0/10`.

## Modes WAN

Deux modes, choisis dans le contrat (`wan.mode`) :

=== "routed_ip (recommandé)"

    Une **IP publique supplémentaire** est routée vers la VM routeur. La NIC WAN d'OPNsense porte cette IP en
    `/32` (et une MAC dédiée si l'hébergeur l'exige), avec la passerelle de l'hôte déclarée hors sous-réseau
    (`fargw`). IP, passerelle et MAC viennent de `secrets/site.sops.yaml`. OPNsense reçoit directement le trafic
    public : aucune translation sur l'hôte.

=== "nat (repli)"

    Un réseau de transit `vmbr1` (`10.255.0.0/30`, hôte `.1`, OPNsense `.2`) relie l'hôte à OPNsense.
    Un DNAT nftables posé sur l'hôte par le rôle `host-tuning` redirige 443, 80 et les ports NetBird vers
    OPNsense. Plus simple à obtenir, un saut de plus à diagnostiquer.

Les ports publics (`wan.public_ports`) : 443/tcp et 80/tcp vers `edge`, 3478/udp et la plage TURN vers `netbird`.
Dans les deux modes, OPNsense les redirige (DNAT) de son adresse WAN vers l'IP interne du service. Ces redirections
sont écrites dans le `config.xml` de bootstrap (stack `10-router`, l'API NAT du provider n'existant qu'à partir
d'OPNsense 26.1) ; les règles M1 de la stack `60-opnsense-rules` les autorisent. Modifier `wan.public_ports` demande
de réimporter la configuration : `tofu apply -replace=module.opnsense.proxmox_virtual_environment_vm.this` dans `10-router`.

## DNS

- Domaine public : `example.net` (le vôtre, dans le contrat). Les enregistrements sont créés par la
  stack `70-dns` et external-dns.
- Domaine interne : `pad.internal` (non publié). Résolu par Unbound sur OPNsense (`10.20.10.1`), par exemple
  `registry.pad.internal` pour Zot.
- Les certificats viennent d'ACME en DNS-01 (cert-manager, webhook OVH pour le cluster ; Traefik de `edge` pour le
  public).

## Accès d'administration

L'hôte Proxmox doit rester joignable indépendamment de la plateforme (SSH, console), de sorte qu'une erreur de règle
OPNsense ou la destruction de la plateforme ne coupe jamais l'accès à l'hôte. La zone MGMT sert à OpenTofu pour joindre OPNsense (`https://10.20.10.1`) et à CAPMOX pour joindre l'API Proxmox.
Une route retour `10.20.0.0/16` via la passerelle MGMT est posée sur l'hôte par Ansible.

## Pools d'adresses Cilium

Cilium LB-IPAM alloue deux pools, sélectionnés par le label `pad.io/lb-pool` des Services :

| Pool | Plage | Usage |
|---|---|---|
| `ingress` | `10.20.60.200`–`10.20.60.220` | Traefik interne du cluster (`10.20.60.200`) |
| `instances` | `10.20.70.100`–`10.20.70.199` | une IP par instance de challenge, joignable via NetBird |
