# ADR 3 : IaC de l'hyperviseur : OpenTofu et bpg/proxmox

**Statut** : acceptée.

## Contexte

Bridges, VM, LXC et images doivent être créés de façon reproductible, sans Packer, et sans que le state ne devienne une fuite de secrets.

## Décision

**OpenTofu** avec le provider `bpg/proxmox` pilote bridges, VM, LXC et le téléchargement des images, **épinglées par checksum**. Une stack égale un state ; chaque state est **chiffré nativement** par OpenTofu (`pbkdf2` + `aes_gcm`, passphrase dans `TF_VAR_state_passphrase`), en backend local sous `.state/tofu/`. Ansible prend le relais pour la configuration interne des LXC et de l'hôte.

## Alternatives écartées

- **Terraform** : licence BSL et pas de chiffrement natif du state.
- **Packer + scripts shell** : plus de pièces mobiles pour un résultat moins déclaratif.
- **Ansible seul** : pas de graphe de dépendances ni de plan/diff pour l'infrastructure.

## Conséquences

- Le state est local : le sauvegarder est de la responsabilité de l'opérateur, ainsi que la passphrase.
- Les `.terraform.lock.hcl` doivent être générés (`task tofu:lock`) sur une machine qui a accès aux registries.
- Les neuf stacks s'enchaînent dans l'ordre de `task up` et se détruisent dans l'ordre inverse.
