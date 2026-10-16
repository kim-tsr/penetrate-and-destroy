# Destroy : supprimer la plateforme

`task destroy` supprime **tout sauf l'hôte Proxmox** : le cluster `pad-prod`, les LXC, la VM OPNsense, les règles et
zones réseau, et les configurations Authentik, NetBird, Warpgate et DNS.

!!! danger "Les données sont perdues"
    La base MariaDB de CTFd et les buckets Garage disparaissent avec le cluster. Lancer `task backup` **avant** et
    vérifier que la sauvegarde est lisible (voir [Sauvegarde et restauration](backup-restore.md)).

## Confirmation

Le script `scripts/confirm-destroy.sh` exige une confirmation explicite :

- **interactif** : taper `destroy` ;
- **non interactif** (CI, script) : `PAD_CONFIRM_DESTROY=destroy task destroy`. L'option `--yes` de `task` seule ne
  suffit pas.

## Ordre de destruction

1. `task bootstrap:destroy` : le cluster étant auto-géré, il ne peut pas se supprimer lui-même. Le script fait un
   **pivot inverse** vers un `kind` frais (après avoir gelé l'application-controller d'ArgoCD pour qu'il ne recrée pas les
   objets), supprime l'objet `Cluster`, et attend la disparition des `Machine`. En repli (confirmation requise), il
   supprime les VM par tag via l'API Proxmox.
2. Destruction des stacks tofu dans l'ordre inverse du déploiement : `70-dns`, `50-warpgate`, `40-netbird`,
   `30-authentik`, `20-services-lxc`, `60-opnsense-rules`, `15-talos-image`, `10-router`, `00-host-network`.

Une stack sans state est ignorée. L'opération peut être rejouée si elle s'arrête en route.

## Ce qui reste

- L'hôte Proxmox et ses disques ZFS.
- Le dépôt Git, les fichiers SOPS et les **clés age** (indispensables pour reconstruire).
- Les sauvegardes locales (`.state/backups`) et externes.
- Le state tofu chiffré (`.state/tofu`) : à conserver si vous voulez nettoyer proprement ; il est inutile après une
  destruction complète.

## Si la destruction bloque

| Blocage | Action |
|---|---|
| Le pivot inverse échoue | relancer ; sinon confirmer le repli par l'API Proxmox (suppression des VM étiquetées) |
| Un LXC ne se supprime pas | `pct stop <vmid> --skiplock` puis `pct destroy <vmid>`, et relancer la destruction de la stack |
| `tofu destroy` échoue sur OPNsense | les ressources de règles dépendent de la VM : détruire d'abord `60-opnsense-rules`, ou retirer la ressource du state |
| Bridge `vmbr2` utilisé | un invité y est encore branché : l'arrêter |

Pour reconstruire ensuite : [Rebuild](rebuild.md) ou [Up](up.md).
