# OPNsense

**Couche** : Hyperviseur et réseau · **Où** : VM Proxmox (VMID 200, 2 vCPU, 1,5 Go) · **Version** : 25.7 (image nano épinglée par sha256)

## À quoi elle sert ici et pourquoi ce choix

Seule la VM OPNsense franchit le bridge `vmbr2` : elle route les **sept zones VLAN** et applique la matrice de flux
« deny all par défaut ». Elle fournit aussi le DNS interne (Unbound, DNSSEC) et un IDS (Suricata). Décision et
alternatives écartées (pfSense, VyOS) : [ADR 1](../adr/001-routeur-opnsense.md). Règles : [Matrice de flux](../architecture/flux.md).

## Où elle tourne et comment elle est déployée

Stack tofu `10-router` (module `opnsense-vm`) : l'image nano est téléchargée par Proxmox avec **checksum sha256 vérifié**,
puis une ISO de configuration (`config.xml` rendu par `templatefile`) est montée et importée au premier boot par
l'importer d'OPNsense (frappes clavier via l'API Proxmox, best-effort). Ensuite, la stack `60-opnsense-rules`
applique **toutes** les règles par l'API.

## Version épinglée

- `router.version: "25.7"` dans `infra/contracts.yaml`.
- Checksum de l'image : `infra/tofu/stacks/10-router/variables.tf`.
- Provider de règles : `browningluke/opnsense` 0.26.0 ([page](tofu-opnsense.md)).

## Fichiers de configuration dans le dépôt

- `infra/opnsense/config.xml.tmpl`, `build-config-iso.sh`, `import-config.sh`, `README.md` (procédure de secours).
- `infra/tofu/modules/opnsense-vm/` et `infra/tofu/stacks/10-router/`.
- `infra/tofu/stacks/60-opnsense-rules/main.tf` : la matrice (préfixes M1 à M10 et I*).
- `secrets/opnsense.example.yaml` : mot de passe root (bcrypt), clé et secret d'API.

## Interactions avec les autres briques

- Reçoit le trafic Internet (DNAT des ports publics du contrat) et le route vers [Traefik edge](traefik-edge.md) et [NetBird](netbird.md).
- Pilotée par [OpenTofu](opentofu.md) (VM et règles).
- Scrapée par [VictoriaMetrics](victoriametrics.md) (`os-node_exporter`, port 9100 sur l'IP MGMT).
- Passerelle de toutes les zones, y compris des nœuds [Talos](talos.md).

## Sécurité

- SSH par clé uniquement, GUI et API en HTTPS sur la zone MGMT seulement.
- Le secret d'API en clair n'est jamais écrit dans l'ISO (seulement son hash).
- Règles « automation » évaluées en premier, puis un blocage final **journalisé**.
- Le trafic intra-zone ne traverse pas OPNsense : il est filtré par Cilium et NetBird.
- DHCP désactivé, toutes les adresses sont statiques.

## Supervision

- Alerte `OpnsenseDown` : [OPNsense indisponible](../runbooks/opnsense-down.md) ; une panne du routeur inhibe les alertes réseau.
- Dashboard `pad-security` (panneaux OPNsense) ; blocages journalisés.

## Opérations courantes

```bash
task tofu:plan-stack STACK=60-opnsense-rules
task tofu:apply-stack STACK=60-opnsense-rules
# secours si l'import de configuration échoue : voir infra/opnsense/README.md
```

## Pièges connus

- L'import de configuration par frappes clavier est best-effort : une procédure manuelle d'une minute existe.
- Un changement de `config.xml` seul n'altère pas une VM déjà configurée (`ignore_changes = [cdrom]`) ; pour réimporter,
  recréer la VM avec `-replace`.
- Le provider ne gère pas le NAT sortant.

## Documentation officielle

[docs.opnsense.org](https://docs.opnsense.org/)

[Retour à l'index des composants](index.md){ .md-button }
