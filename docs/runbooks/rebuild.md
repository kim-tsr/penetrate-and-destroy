# Rebuild : détruire puis reconstruire

`task rebuild` enchaîne [destroy](destroy.md) puis [up](up.md) et affiche la durée totale de reconstruction
(`Rebuild en <n>s`). C'est la démonstration de l'objectif « jetable et reconstructible », et le moyen de remettre à
zéro une plateforme dans un état douteux.

## Séquence recommandée

1. **Annoncer** l'arrêt (aucun événement en cours).
2. **Sauvegarder** : `task backup`, puis copier la sauvegarde hors du poste si possible.
3. **Contrôler les clés** : les clés age (opérateur et cluster) sont sauvegardées hors machine.
4. `task rebuild` (confirmation `destroy` requise).
5. Attendre la fin de `task up` (ArgoCD termine la synchronisation après le bootstrap).
6. **Restaurer** les données : `task restore` ([détails](backup-restore.md)) une fois MariaDB et Garage `Ready`.
7. Refaire les [actions manuelles](../operations/actions-post-deploiement.md) : elles ne sont pas conservées par la
   destruction (policy NetBird par défaut, PAT, règles de routing peers).
8. `task verify`.

## Combien de temps

Le temps total dépend de la bande passante (téléchargement d'images Talos et de conteneurs) et de la vitesse
de l'hôte. Il est mesuré par `task rebuild` lui-même. À renseigner après le premier essai réel :

!!! info "Mesure à compléter"
    Durée du premier rebuild chronométré : *à renseigner après un déploiement réel*.

## Rebuild partiel

Pas besoin de tout détruire pour repartir d'une couche :

| Besoin | Commande |
|---|---|
| refaire seulement le cluster | `task bootstrap:destroy` puis `task bootstrap:cluster bootstrap:gitops` |
| refaire un LXC | `tofu apply -replace=...` dans la stack `20-services-lxc`, puis `task ansible:services` |
| refaire le routeur | voir [OPNsense indisponible](opnsense-down.md) |
| rejouer la config d'un service | `task ansible:services` |

Les données de CTFd sont dans le cluster : un rebuild du cluster exige une restauration.
