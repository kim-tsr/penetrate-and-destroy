# Provider carlpett/sops

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 1.4.1

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `carlpett/sops`. Lit les fichiers `*.sops.yaml` dans tofu (data source `sops_file`) : jeton Proxmox, valeurs de site, secrets OPNsense, OVH, Authentik, NetBird, Warpgate.

Utilisé par : toutes les stacks. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : toutes les stacks.

## Version épinglée

`carlpett/sops` **1.4.1**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `providers.tf` de chaque stack ; version dans chaque `versions.tf`
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Voir la [chaîne des secrets](../architecture/secrets.md). Ce provider ne déchiffre jamais avec la clé du cluster.
Orchestré par [OpenTofu](opentofu.md) ; les secrets viennent du [provider sops](tofu-sops.md).

## Sécurité

Les valeurs déchiffrées n'existent qu'en mémoire (et dans le state **chiffré**). La clé age de l'opérateur (`SOPS_AGE_KEY_FILE`) est requise.

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

Voir la [chaîne des secrets](../architecture/secrets.md). Ce provider ne déchiffre jamais avec la clé du cluster.

## Documentation officielle

[Registry : carlpett/sops](https://registry.terraform.io/providers/carlpett/sops/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
