# Provider ovh/ovh

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 2.22.0

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `ovh/ovh`. Publie les enregistrements DNS A publics (front, auth, vpn, status) vers l'IP WAN de la plateforme. Les noms internes ne sont jamais publiés.

Utilisé par : 70-dns. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 70-dns.

## Version épinglée

`ovh/ovh` **2.22.0**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/70-dns/main.tf`
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l'API OVH ; les enregistrements publics pointent vers l'[edge](traefik-edge.md) (via [OPNsense](opnsense.md)).
Orchestré par [OpenTofu](opentofu.md) ; secrets lus par le [provider sops](tofu-sops.md).

## Sécurité

Identifiants OVH dans `secrets/ovh.sops.yaml` (jeton à créer avec GET/POST/PUT/DELETE limités à `/domain/zone/<zone>/*`, où `<zone>` est la zone OVH, c'est-à-dire `dns_zone` si la plateforme vit sur un sous-domaine, pas le sous-domaine lui-même). L'IP WAN vient de `secrets/site.sops.yaml`.

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

La même famille d'identifiants OVH sert à [cert-manager](cert-manager.md) (DNS-01), à [external-dns](external-dns.md) et au résolveur ACME de [Traefik edge](traefik-edge.md).

## Documentation officielle

[Registry : ovh/ovh](https://registry.terraform.io/providers/ovh/ovh/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
