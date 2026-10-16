# OpenTofu

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur et CI (jamais sur le serveur) · **Version** : >= 1.10.0 (version du devshell Nix)

## À quoi elle sert ici et pourquoi ce choix

OpenTofu décrit l'infrastructure : bridges, routeur, LXC, image Talos, IdP, VPN, bastion, règles pare-feu et DNS.
Il apporte un graphe de dépendances, un `plan`/`diff` et un **chiffrement natif du state**, ce qui le distingue de
Terraform (licence BSL, pas de chiffrement). Décision : [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Il s'exécute sur le poste de l'opérateur (ou en CI pour `validate`), via `task tofu:apply-stack STACK=<nom>`.
Neuf stacks, un state par stack, enchaînés par `task up` dans cet ordre : `00-host-network`, `10-router`,
`15-talos-image`, `60-opnsense-rules`, `20-services-lxc`, `30-authentik`, `40-netbird`, `50-warpgate`, `70-dns`.
`task destroy` les détruit dans l'ordre inverse.

## Version épinglée

- Binaire : `opentofu` du devshell, figé par `flake.lock` ([Nix](nix.md)). Contrainte `required_version = ">= 1.10.0"`
  dans chaque `versions.tf`.
- Providers : version exacte dans `required_providers` de chaque `infra/tofu/stacks/*/versions.tf` et dans
  `infra/tofu/modules/*/versions.tf`, plus `.terraform.lock.hcl` commité (`task tofu:lock`). Détail : pages
  [bpg/proxmox](tofu-bpg-proxmox.md), [OPNsense](tofu-opnsense.md), [Authentik](tofu-authentik.md),
  [NetBird](tofu-netbird.md), [Warpgate](tofu-warpgate.md), [OVH](tofu-ovh.md), [SOPS](tofu-sops.md).

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/<nn>-<nom>/` : `main.tf`, `providers.tf`, `variables.tf`, `versions.tf`, `outputs.tf`.
- `infra/tofu/modules/` : `proxmox-network`, `lxc-service`, `opnsense-vm`, `talos-image`.
- `infra/tofu/Taskfile.yml` : `apply-stack`, `plan-stack`, `destroy-stack`, `fmt`, `validate-all`, `lock`.
- Chaque stack lit `infra/contracts.yaml` par `yamldecode(file(...))` (local `c`).

## Interactions avec les autres briques

- Lit le **contrat** et les secrets SOPS ([provider sops](tofu-sops.md)).
- Pilote Proxmox, OPNsense, Authentik, NetBird, Warpgate et OVH par leurs providers.
- Génère l'inventaire Ansible (`hosts.generated.yml`) à la fin de `20-services-lxc` : voir [Ansible](ansible.md).

## Sécurité

- **State chiffré** : bloc `encryption` avec `pbkdf2` (passphrase `TF_VAR_state_passphrase`) et `aes_gcm`,
  `enforced = true` pour le state et les plans. Backend local `.state/tofu/<stack>.tfstate`, ignoré par Git.
- Secrets lus à l'exécution depuis SOPS, jamais en variable en clair dans le dépôt.
- La CI ne fait que `fmt -check` et `validate` ; aucun `apply` n'est lancé hors du poste de l'opérateur.

## Supervision

Pas de métrique propre. La dérive est visible par `task tofu:plan-stack`. Les ressources créées sont supervisées par
les briques correspondantes. Procédures : [Up](../runbooks/up.md), [Destroy](../runbooks/destroy.md).

## Opérations courantes

```bash
export TF_VAR_state_passphrase=...       # chiffrement du state (à garder avec la clé age)
task tofu:plan-stack STACK=20-services-lxc
task tofu:apply-stack STACK=20-services-lxc
task tofu:validate-all                   # fmt -check + validate sans accès serveur
task tofu:lock                           # régénère les .terraform.lock.hcl
```

## Pièges connus

- Perdre la passphrase ou le dossier `.state/` rend les stacks illisibles : à sauvegarder avec la clé age.
- `destroy-stack` ignore silencieusement une stack sans state.
- Les registries tofu sont bloqués dans l'environnement cloud des agents : `validate` y est limité.

## Documentation officielle

[opentofu.org/docs](https://opentofu.org/docs/)

[Retour à l'index des composants](index.md){ .md-button }
