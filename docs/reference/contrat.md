# Le contrat `infra/contracts.yaml`

`infra/contracts.yaml` est la **source unique de vérité** : toute IP, tout CIDR, nom DNS, groupe d'identité, port et
namespace utilisé ailleurs en vient. Il est consommé par OpenTofu, Ansible, GitOps et les scripts. S'il manque une
valeur, **on l'ajoute au contrat** ; on ne la code jamais en dur.

## Comment chaque outil le lit

| Consommateur | Mécanisme |
|---|---|
| OpenTofu | `yamldecode(file("${path.root}/../../contracts.yaml"))` (local `c`) |
| Ansible | `vars_files: ../contracts.yaml` via `group_vars/all/contracts.yml` |
| GitOps | valeurs recopiées dans les manifestes, avec un commentaire `# contracts: <chemin>` ; `scripts/lint.sh` vérifie la cohérence des IP clés |
| Scripts | `yq` (par exemple `scripts/verify.sh`) |

Les valeurs propres à un site (URL de l'API Proxmox, accès SSH à l'hôte, IP publique, passerelle, MAC) ne sont **pas**
dans le contrat : l'opérateur les fournit dans `secrets/site.sops.yaml`, chiffré ([Valeurs de site](site.md)). Dans le
dépôt, les valeurs à fournir valent `CHANGEME`.

## Sections

| Clé | Contenu | Exemple (fictif) |
|---|---|---|
| `project`, `domain`, `internal_domain` | nom, domaine public, domaine interne | `example.net`, `pad.internal` |
| `git` | URL HTTPS et SSH du dépôt, branche suivie par ArgoCD | `main` |
| `host` | nom du nœud Proxmox, bridges, datastores, plafond ARC ZFS, IP de l'hôte en MGMT | `pve`, `10.20.10.2` |
| `wan` | mode (`routed_ip` ou `nat`), réseau de transit, ports publics | 443/tcp, 80/tcp, 3478/udp |
| `zones` | VLAN, CIDR et passerelle des sept zones | `mgmt: vlan 10, 10.20.10.0/24` |
| `dns_resolver` | résolveur de chaque zone (Unbound sur OPNsense) | `10.20.10.1` |
| `flow_ports` | ports de la matrice de flux (SSH, API Kubernetes, Talos, monitoring...) | `kube_api: 6443` |
| `router` | VM OPNsense : vmid, version, ressources | `vmid: 200` |
| `services` | LXC : vmid, zone, IP, ressources | `edge: 210, 10.20.20.10` |
| `kubernetes` | version de Talos et Kubernetes, VIP, control plane, pools, CIDR pods/services, pools Cilium, versions des providers CAPI, image de `kind` | pool `challenges` min 1, max 3 |
| `acme` | e-mail ACME, endpoint OVH, groupe du webhook | |
| `hostnames` | sous-domaines de `domain` : `front` (`ctf`), `auth`, `vpn`, `bastion`, `grafana`, `argocd`, `ctfd_admin`, `registry`, `status`... | `ctf.example.net` |
| `identity` | fournisseur, groupes, `client_id` OIDC par application | `ctf-players`, `pad-frontend` |
| `netbird` | groupes, routing peers, plage overlay, nom des networks, préfixe des groupes d'équipe | `ctf-team-` |
| `namespaces` | namespaces Kubernetes, préfixe des namespaces d'instances | `inst-` |
| `apps` | endpoints internes (CTFd, chall-manager, Garage, Valkey, registry), buckets | `ctfd-uploads`, `backups` |
| `monitoring` | URL de push (remote_write, Loki, OTLP), exporters scrapés, cible de l'hôte | |
| `ports` | ports d'écoute des services LXC (edge, netbird, warpgate, authentik, monitoring) | |

## Règles de modification

1. Changer une valeur : modifier **le contrat**, puis rejouer les phases concernées (`task tofu:apply-stack ...`,
   `task ansible:services`, commit pour ArgoCD). Les commentaires `# contracts:` des manifestes indiquent où la
   valeur a été recopiée.
2. Nouvelle valeur : l'ajouter au contrat avec un commentaire, puis la consommer.
3. Aucune IP publique ni nom d'hôte dans le contrat commité (ils vont dans `secrets/site.sops.yaml`) ; domaine :
   `CHANGEME` ou valeur de documentation.
4. `bash scripts/lint.sh` contrôle les IP clés (VIP du cluster, IP d'ingress) entre contrat et manifestes.

## Réserver des plages

| Plage | Réservation |
|---|---|
| VMID 200 | routeur |
| VMID 210 à 250 | LXC de services |
| VMID 299 | template Talos |
| VMID 300 à 399 | nœuds Talos (CAPMOX) ; le template de clonage du contrat est hors de cette plage |
| `10.20.60.200`-`.220` | LB Cilium d'ingress |
| `10.20.70.100`-`.199` | LB Cilium des instances (100 adresses = plafond d'instances simultanées) |

Voir [Réseau et zones](../architecture/reseau.md) pour le détail.
