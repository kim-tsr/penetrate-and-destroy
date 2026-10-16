# Provider warp-tech/warpgate

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 1.2.0

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `warp-tech/warpgate`. Crée dans Warpgate un rôle par groupe d'accès (défaut `infra-admins`) et les cibles SSH (LXC, OPNsense, hôte) et HTTP (UI OPNsense, UI Proxmox), rattachées à ces rôles.

Utilisé par : 50-warpgate. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 50-warpgate.

## Version épinglée

`warp-tech/warpgate` **1.2.0**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/50-warpgate/` (`roles.tf`, `targets.tf`) et son `README.md`
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l’API de la brique qu’il pilote (voir ci-dessus) ; dépend de l’ordre des stacks de `task up`.
Orchestré par [OpenTofu](opentofu.md) ; les secrets viennent du [provider sops](tofu-sops.md).

## Sécurité

Jeton d'API admin dans `secrets/warpgate-tofu.sops.yaml`. Le certificat de Warpgate est auto-signé : l'accès direct demande `insecure_skip_verify`.

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

Provider communautaire, compatible Warpgate 0.29. Il ne gère pas les fournisseurs SSO (OIDC est posé dans `warpgate.yaml` par Ansible). Les nœuds Talos n'ont pas de SSH : pas de cible.

## Documentation officielle

[Registry : warp-tech/warpgate](https://registry.terraform.io/providers/warp-tech/warpgate/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
