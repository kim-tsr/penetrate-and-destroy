# Rebuild : détruire puis reconstruire

`task rebuild` enchaîne [destroy](destroy.md) puis [up](up.md) et affiche la durée totale (`Rebuild en <n>s`). C'est la démonstration de
l'objectif « jetable et reconstructible », et le moyen de remettre à zéro une plateforme dans un état douteux. Pour ne refaire que le cluster :
`task cluster:rebuild`. Pas à pas : [Guide de déploiement](../guide-deploiement.md).

## Séquence recommandée (rebuild complet)

1. **Annoncer** l'arrêt (aucun événement en cours).
2. **Sauvegarder** : `task backup`, puis copier la sauvegarde hors du poste.
3. **Contrôler les clés** : clés age (opérateur et cluster) et phrase secrète des states sauvegardées hors machine.
4. `task rebuild` (confirmation `destroy` requise). Les phases 10 et 11 s'arrêtent tant que le dépôt n'est pas poussé et que les jetons
   NetBird/Warpgate **de la nouvelle installation** n'existent pas : NetBird et Warpgate repartent de zéro, leurs anciens jetons ne valent plus. Remettre `CHANGEME`
   dans `secrets/netbird-tofu.sops.yaml`, `secrets/warpgate-tofu.sops.yaml` et `netbird_server_api_token` avant de relancer, pour que la vérification les réclame.
5. **Restaurer** les données : `task restore` ([détails](backup-restore.md)) une fois MariaDB et Garage `Ready`.
6. Refaire les [actions manuelles](../operations/actions-post-deploiement.md), qui ne survivent pas à la destruction (policy NetBird par défaut, PAT, routing peers, MFA).
7. `task phase:12-verify`.

## Combien de temps

Le temps total dépend de la bande passante et de l'hôte ; il est mesuré par `task rebuild`.

!!! info "Mesure à compléter"
    Durée du premier rebuild chronométré : *à renseigner après un déploiement réel*.

## Rebuild partiel

| Besoin | Commande |
|---|---|
| refaire seulement le cluster | `task cluster:rebuild` (ou `task cluster:destroy` puis `task phase:9-cluster phase:10-gitops`) |
| cluster cassé, API injoignable | `task cluster:destroy-force`, puis `task phase:9-cluster` et `task phase:10-gitops` |
| refaire un LXC | `tofu apply -replace=...` dans la stack `20-services-lxc`, puis `task ansible:services` |
| refaire le routeur | voir [OPNsense indisponible](opnsense-down.md) |
| rejouer la config d'un service | `task ansible:services` |
| repartir vraiment de zéro | `task destroy`, `task check:tout-detruit`, `task state:purge` |

Les données de CTFd sont dans le cluster : un rebuild du cluster exige une restauration.
