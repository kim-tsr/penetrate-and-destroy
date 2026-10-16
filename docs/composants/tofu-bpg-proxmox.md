# Provider bpg/proxmox

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 0.116.1

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `bpg/proxmox`. Crée bridges et VLAN, LXC (Debian 13, non privilégiés, nesting et keyctl pour Docker), la VM OPNsense et le template Talos, et télécharge les images avec vérification de checksum.

Utilisé par : 00-host-network, 10-router, 15-talos-image, 20-services-lxc, modules `proxmox-network`, `lxc-service`, `opnsense-vm`, `talos-image`. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 00-host-network, 10-router, 15-talos-image, 20-services-lxc, modules `proxmox-network`, `lxc-service`, `opnsense-vm`, `talos-image`.

## Version épinglée

`bpg/proxmox` **0.116.1**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/00-host-network/providers.tf` (endpoint depuis `site.proxmox_url`, jeton depuis `proxmox.api_token`)
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l’API de la brique qu’il pilote (voir ci-dessus) ; dépend de l’ordre des stacks de `task up`.
Orchestré par [OpenTofu](opentofu.md) ; les secrets viennent du [provider sops](tofu-sops.md).

## Sécurité

Le jeton d'API est lu depuis SOPS ; `insecure` vient de `secrets/proxmox.sops.yaml`. Le pare-feu Proxmox des LXC est désactivé (`firewall = false`) : le filtrage est assuré par OPNsense.

## Supervision

Aucune métrique propre. La dérive se voit par `task tofu:plan-stack STACK=<nom>` ; les ressources pilotées sont
supervisées par leurs briques. En cas de panne d'une stack : [Incident générique](../runbooks/incident.md).

## Opérations courantes

```bash
task tofu:plan-stack STACK=<stack>
task tofu:apply-stack STACK=<stack>
task tofu:lock        # régénère les verrous après un changement de version
```

## Pièges connus

Le provider parle à l'API Proxmox : c'est le seul lien tofu vers l'hôte. Les modules de LXC activent `nesting` et `keyctl`, requis par Docker dans un conteneur non privilégié.

## Documentation officielle

[Registry : bpg/proxmox](https://registry.terraform.io/providers/bpg/proxmox/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
