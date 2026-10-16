# Destroy : supprimer le cluster ou la plateforme

Deux niveaux, tous deux protégés par `scripts/confirm-destroy.sh`. Explications et cas particuliers : [Guide de déploiement](../guide-deploiement.md), section « Détruire, reconstruire, repartir de zéro ».

!!! danger "Les données sont perdues"
    La base MariaDB de CTFd et les buckets Garage disparaissent avec le cluster. Lancer `task backup` **avant** et
    vérifier que la sauvegarde est lisible (voir [Sauvegarde et restauration](backup-restore.md)).

## Confirmation

- **interactif** : taper `destroy` ;
- **non interactif** (CI, script) : `PAD_CONFIRM_DESTROY=destroy task destroy`. L'option `--yes` de `task` seule ne suffit pas.

## Le cluster seul

| Tâche | Quand | Effet |
|---|---|---|
| `task cluster:destroy` | cluster sain | gèle l'application-controller d'ArgoCD, **pivot inverse** vers un `kind` frais, suppression de l'objet `Cluster` : CAPMOX détruit les VM Talos |
| `task cluster:destroy-force` | cluster cassé ou pivot impossible | suppression directe, par l'API Proxmox, des VM étiquetées `pad-prod` de la plage VMID du cluster (hors template) |

Puis `task check:cluster-detruit` (VM, kind, kubeconfig, volumes persistants orphelins du CSI à libérer avec `pvesm free`). Reconstruire : `task cluster:rebuild`.
Routeur, LXC, DNS et accès NetBird/Warpgate ne sont pas touchés.

## Tout sauf l'hôte : `task destroy`

Ordre inverse du déploiement :

1. `70-dns`, `50-warpgate`, `40-netbird`, `30-authentik` ;
2. le cluster (pivot inverse, repli API Proxmox) ;
3. `20-services-lxc`, `60-opnsense-rules`, `15-talos-image`, `10-router`, `00-host-network`.

- Une stack sans state est ignorée : un state manquant ne bloque jamais.
- `30`, `40`, `50` et `60` configurent un service détruit juste après : si leur API a déjà disparu, leur state est mis de côté dans `.state/tofu/orphelins/` et l'opération continue.
- `70-dns` (enregistrements chez le fournisseur) et les stacks qui parlent à Proxmox s'arrêtent sur erreur : corriger, relancer (idempotent).
- Fin : `task check:tout-detruit`.

## Ce qui reste

- L'hôte Proxmox, ses stockages, son jeton API et son utilisateur SSH.
- Le dépôt Git, les fichiers SOPS et les **clés age** (indispensables pour reconstruire), la phrase secrète des states.
- Les sauvegardes locales (`.state/backups`) et externes.
- Les states tofu chiffrés (`.state/tofu`) : inutiles après une destruction complète. Pour repartir vraiment de zéro : `task state:purge`.

## Si la destruction bloque

| Blocage | Action |
|---|---|
| Le pivot inverse échoue | relancer ; sinon `task cluster:destroy-force` |
| Un LXC ne se supprime pas | `pct stop <vmid> --skiplock` puis `pct destroy <vmid> --purge`, et relancer `task destroy` |
| `tofu destroy` échoue sur OPNsense | les règles dépendent de la VM : `60-opnsense-rules` est tolérante ; sinon retirer le state (`task state:purge -- --force` en dernier recours) |
| Bridge `vmbr2` utilisé | un invité y est encore branché : l'arrêter |
| Phrase secrète des states perdue | supprimer à la main les invités du contrat, puis `task state:purge -- --force` |

Pour reconstruire ensuite : [Rebuild](rebuild.md) ou [Up](up.md).
