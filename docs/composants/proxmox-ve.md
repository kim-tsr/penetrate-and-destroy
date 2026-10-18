# Proxmox VE

**Couche** : Hyperviseur et réseau · **Où** : hôte bare metal (le seul serveur) · **Version** : 9.x (prérequis, non piloté par le dépôt)

## À quoi elle sert ici et pourquoi ce choix

Tout tient sur **un seul hôte Proxmox** : il héberge la VM routeur, les LXC de services et les VM Talos du cluster.
Proxmox expose une API (port 8006) que pilotent OpenTofu, Cluster API (CAPMOX) et le driver CSI, ce qui rend la
plateforme reconstructible par du code. Le dépôt ne décrit jamais l'hôte réel : on parle d'« un hôte Proxmox » dont
l'URL d'API, l'accès SSH et l'IP publique sont des entrées de l'opérateur (`secrets/site.sops.yaml`, voir
[Valeurs de site](../reference/site.md)).

## Où elle tourne et comment elle est déployée

Proxmox est **le seul élément que le dépôt ne crée pas** : il est installé à la main (prérequis du
[Démarrage rapide](../demarrage-rapide.md)). Le dépôt le configure ensuite en deux temps :

- la stack tofu `00-host-network` crée les bridges (voir [bpg/proxmox](tofu-bpg-proxmox.md)) ;
- le rôle Ansible `host-tuning` règle l'hôte (`task ansible:host`).

`task destroy` supprime tout **sauf** l'hôte.

## Version épinglée

Aucune version n'est épinglée par le dépôt (l'hôte est un prérequis : Proxmox VE 9.x). Ce qui est épinglé :

| Élément | Valeur | Où |
|---|---|---|
| nom du nœud | `pve` | `infra/contracts.yaml` (`host.node`) |
| datastore des VM | `local-zfs` | `infra/contracts.yaml` (`host.datastore_vm`) |
| ARC ZFS plafonné | 2 GiB | `infra/contracts.yaml` (`host.zfs_arc_max_bytes`) |
| plage de VMID du cluster | 300 à 399 | `infra/contracts.yaml` (`kubernetes.vmid_range`) |

## Fichiers de configuration dans le dépôt

- `infra/contracts.yaml` : section `host`, `wan`, `zones`, `services` (VMID, IP, ressources).
- `infra/ansible/roles/host-tuning/` : ARC ZFS, sysctl, DNAT de repli (`pad-nat.nft.j2`), `notrack` des trames pontées du pont des zones (`pad-raw.nft.j2`, tag `host_bridge_notrack`), exporters.
- `infra/ansible/inventories/prod/group_vars/proxmox_host.yml` et `hosts.example.yml` : inventaire de l'hôte.
- `infra/tofu/modules/proxmox-network/`, `lxc-service/`, `opnsense-vm/`, `talos-image/` : ce que tofu crée dessus.
- `secrets/proxmox.example.yaml` (token d'API, SSH) et `secrets/site.example.yaml` (URL, IP publique) : modèles.

## Interactions avec les autres briques

- **OpenTofu** : crée bridges, VM, LXC, templates via l'API ([bpg/proxmox](tofu-bpg-proxmox.md)).
- **Cluster API / CAPMOX** : clone le template Talos pour créer les nœuds ([CAPMOX](capmox.md)).
- **Proxmox CSI** : crée les volumes sur `local-zfs` ([Proxmox CSI](proxmox-csi.md)).
- **Warpgate** : cibles SSH et HTTP (UI/API sur `:8006`) pour le personnel ([Warpgate](warpgate.md)).
- **Monitoring** : l'hôte est scrapé (node-exporter, pve-exporter) et pousse ses logs via Alloy.
- **OPNsense** : seule la VM routeur franchit le bridge `vmbr2` ; l'hôte a une patte `vmbr2.10` (zone MGMT).

## Sécurité

- Le bridge `vmbr2` est **VLAN-aware et sans uplink** : tout trafic inter-zones passe par OPNsense.
- L'API n'est joignable depuis le cluster que sur le port `proxmox_api` (8006), flux M9 de la [matrice](../architecture/flux.md).
- Les exporters de l'hôte sont liés à l'IP MGMT (`host.monitoring.host_target`), jamais à l'IP publique.
- Jeton d'API et accès SSH : uniquement dans les secrets SOPS, jamais en clair. L'utilisateur de l'exporter
  (`pve-exporter@pve`) n'a qu'un rôle de lecture.

## Supervision

- Métriques : node-exporter (9100) et pve-exporter (9221), jobs `node` et `pve` de VictoriaMetrics.
- Logs : journal de l'hôte via [Alloy](alloy.md) vers Loki.
- Dashboard `pad-capacity` ; alertes `PveNodeDown`, `PveGuestDown`, `PveStorageHigh`, `ZfsPoolNotOnline`...
- Runbooks : [Hôte Proxmox](../runbooks/proxmox-host.md), [Stockage](../runbooks/proxmox-storage.md),
  [Invité arrêté](../runbooks/proxmox-guest-down.md), [Disque](../runbooks/host-disk.md),
  [CPU et mémoire](../runbooks/host-resources.md).

## Opérations courantes

```bash
task ansible:host                    # réglages de l'hôte (idempotent)
task tofu:plan-stack STACK=00-host-network
task site:node -- <nom>              # si le nœud ne s'appelle pas « pve »
```

Côté hôte (opérateur, hors dépôt) : `qm list`, `pct list`, `zpool status`.

## Pièges connus

- Le nom du nœud est une valeur du contrat **et** de manifests gitops : le changer passe par `task site:node`.
- Les VMID 300 à 399 sont réservés au cluster ; ne pas y créer de VM à la main (Cluster API les alloue).
- Une route retour vers `10.20.0.0/16` via la zone MGMT doit exister sur l'hôte (posée par `host-tuning`).

## Documentation officielle

[Documentation Proxmox VE](https://pve.proxmox.com/pve-docs/)

[Retour à l'index des composants](index.md){ .md-button }
