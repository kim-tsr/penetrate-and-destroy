# Valeurs de site

Le dépôt est public : il ne décrit aucun hôte réel. Les valeurs propres à **votre** hôte Proxmox sont des entrées que
vous fournissez dans `secrets/site.sops.yaml`, un fichier chiffré (SOPS + age) comme les autres secrets d'infra.
Le modèle est `secrets/site.example.yaml` : il liste les clés avec une valeur vide et une description.

| Fichier | Versionné | Rôle |
|---|---|---|
| `secrets/site.example.yaml` | oui | modèle : les clés attendues, valeurs vides |
| `secrets/site.sops.yaml` | oui, **chiffré** | vos valeurs, lisibles avec la clé age de l'opérateur |

## Utilisation

```bash
task secrets:init      # crée secrets/site.sops.yaml (vide) avec les autres secrets manquants
sops secrets/site.sops.yaml
task secrets:pending   # liste les clés de site encore vides
```

## Clés

| Clé | Rôle | Requis |
|---|---|---|
| `proxmox_url` | URL de l'API Proxmox, sans chemin (schéma, hôte, port) | oui |
| `ssh_host` | adresse SSH de l'hôte Proxmox (nom ou IP) | oui |
| `ssh_user` | utilisateur SSH de l'hôte (sudo pour le rôle `host-tuning`) | oui |
| `wan.ip` | IPv4 publique de la plateforme (DNS publics, WAN d'OPNsense) | oui |
| `wan.gateway` | passerelle IPv4 du WAN | en mode `routed_ip` |
| `wan.mac` | MAC dédiée de la NIC WAN du routeur | seulement si l'hébergeur l'exige |

## Modes WAN

Le mode se choisit dans le contrat (`wan.mode`) :

- `routed_ip` : une IP publique supplémentaire est routée vers la VM routeur (avec une MAC dédiée si l'hébergeur
  l'exige). `wan.ip` est cette IP, `wan.gateway` la passerelle de l'hôte.
- `nat` : l'hôte garde son IP publique et redirige les ports publics vers OPNsense par DNAT.
  `wan.ip` est l'IP publique de l'hôte ; `wan.gateway` et `wan.mac` sont inutilisés.

## Qui lit quoi

| Consommateur | Mécanisme |
|---|---|
| OpenTofu | `data "sops_file" "site"` (provider `carlpett/sops`) dans les stacks concernées |
| Ansible | variable `pad_site` (`lookup('community.sops.sops', ...)`), adresse et utilisateur de l'inventaire |
| Scripts | `sops --decrypt` puis `yq` (fonction `site_get` de `bootstrap/scripts/lib.sh`) |

## Nom du nœud Proxmox

Le contrat fixe `host.node: pve`, nom par défaut de l'installeur Proxmox. Pour un autre nom :
`task site:node -- <nom>` met à jour le contrat et tous les manifests marqués `# contracts: host.node`.

## Prérequis sur l'hôte

L'hôte Proxmox doit être vierge, ou sans conflit de VMID ni de bridge avec le contrat
([Contrat](contrat.md)). La plateforme ne supprime rien de ce qu'elle n'a pas créé.

## Dans cette documentation

Les exemples utilisent des valeurs fictives : `example.net`, `CHANGEME`. Le domaine public (`domain`) reste dans le
contrat et se remplace dans votre copie du dépôt.
