# Provider netbirdio/netbird

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 0.0.10

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `netbirdio/netbird`. Configure NetBird : groupes, networks (`pad-instances`, `pad-bastion`), routing peers, clés d'installation, connecteur d'identité Authentik, utilisateur de service pour netbird-sync et policy staff vers bastion.

Utilisé par : 40-netbird. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 40-netbird.

## Version épinglée

`netbirdio/netbird` **0.0.10**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/40-netbird/` (`groups.tf`, `networks.tf`, `policies.tf`, `identity_provider.tf`, `service_users.tf`, `setup_keys.tf`)
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l'API de [NetBird](netbird.md) ; crée l'utilisateur de service et les groupes consommés par [netbird-sync](netbird-sync.md).
Orchestré par [OpenTofu](opentofu.md) ; secrets lus par le [provider sops](tofu-sops.md).

## Sécurité

Jeton d'accès personnel dans `secrets/netbird-tofu.sops.yaml`. Aucune policy joueur n'est créée ici : sans policy d'instance, un joueur n'atteint rien.

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

La policy « Default » (tout vers tout) créée par NetBird doit être désactivée pour obtenir le deny all par défaut (voir `infra/tofu/stacks/40-netbird/README.md`). Le stack exige NetBird déjà déployé et un PAT.

## Documentation officielle

[Registry : netbirdio/netbird](https://registry.terraform.io/providers/netbirdio/netbird/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
