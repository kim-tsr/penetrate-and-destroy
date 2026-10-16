# Provider browningluke/opnsense

**Couche** : Hyperviseur et réseau · **Où** : poste opérateur (via [OpenTofu](opentofu.md)) · **Version** : 0.26.0

## À quoi elle sert ici et pourquoi ce choix

Provider OpenTofu `browningluke/opnsense`. Gère toute la matrice de flux d'OPNsense (règles « automation » évaluées en premier, blocage par défaut intégré d'OPNsense, journalisé, en fin de chaîne).

Utilisé par : 60-opnsense-rules. Cadre général : [OpenTofu](opentofu.md) et [ADR 3](../adr/003-iac-hyperviseur.md).

## Où elle tourne et comment elle est déployée

Pas de déploiement propre : le provider est téléchargé par `tofu init` (registry) lors de `task tofu:apply-stack`, sur
le poste de l'opérateur. Stacks concernées : 60-opnsense-rules.

## Version épinglée

`browningluke/opnsense` **0.26.0**, épinglé exactement dans `required_providers` des fichiers `versions.tf` des stacks concernées
(`infra/tofu/stacks/*/versions.tf`), avec le verrou `.terraform.lock.hcl` commité. Renovate propose les mises à jour.

## Fichiers de configuration dans le dépôt

- `infra/tofu/stacks/60-opnsense-rules/providers.tf` et `main.tf`
- Source des valeurs : `infra/contracts.yaml` (noms, IP, ports) et `secrets/*.sops.yaml` (accès).

## Interactions avec les autres briques

Parle à l'API d'[OPNsense](opnsense.md) depuis la zone MGMT ; les ports de la matrice viennent de `flow_ports` du [contrat](../reference/contrat.md).
Orchestré par [OpenTofu](opentofu.md) ; secrets lus par le [provider sops](tofu-sops.md).

## Sécurité

Clé et secret d'API issus de `secrets/opnsense.sops.yaml`. L'API n'est joignable que depuis la zone MGMT (l'hôte, `10.20.10.2`).

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

Le provider ne gère **pas** le NAT sortant (automatique côté OPNsense) ni le bootstrap : celui-ci passe par l'ISO de configuration de la stack `10-router`.

Les redirections de ports WAN (`opnsense_firewall_nat_port_forward`) ne sont pas utilisées : cette ressource appelle
l'API `/api/firewall/d_nat/*`, qui n'existe qu'à partir d'OPNsense 26.1 (404 en 25.7). Elles sont donc rendues dans le
`config.xml` de bootstrap (`wan.public_ports`) ; la stack 60 ne pose que les règles de filtre M1 qui les autorisent.

La règle M0 (`m0-host-zones`, interface mgmt, source = alias `host_proxmox_api`, destination `net_all_zones`, ports SSH, HTTPS, 6443, 50000) autorise le flux de l'hôte Proxmox vers les zones : rebond SSH d'Ansible vers les LXC, et trafic du poste opérateur arrivant par la route du VPN maillé, traduit (SNAT) vers l'IP mgmt de l'hôte.

**Piège : ne jamais créer de règle `block` multi-interfaces dans cette stack.** OPNsense traite une règle posée sur plusieurs interfaces comme une règle **flottante**, évaluée **avant** les règles d'interface, quel que soit son numéro de séquence. L'ancienne règle `default_deny` (séquence 60000, toutes interfaces) bloquait donc toute la matrice (constaté : SSH de l'hôte vers les LXC refusé). Elle a été supprimée : c'est le blocage par défaut intégré d'OPNsense, en fin de chaîne, qui s'applique ; il est journalisé (`config.xml` de bootstrap sans `nologdefaultblock`).

## Documentation officielle

[Registry : browningluke/opnsense](https://registry.terraform.io/providers/browningluke/opnsense/latest/docs)

[Retour à l'index des composants](index.md){ .md-button }
