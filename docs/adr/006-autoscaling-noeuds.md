# ADR 6 : Autoscaling des nœuds : cluster-autoscaler

**Statut** : acceptée.

## Contexte

Le nombre d'instances de challenges varie de zéro à plusieurs dizaines selon l'événement, sur un hôte à ressources limitées.

## Décision

Le **cluster-autoscaler** pilote la `MachineDeployment` du pool `challenges` entre un minimum et un maximum portés par des annotations (1 à 3 par défaut, variables du contrat). Il ajoute une VM Talos quand des pods sont `Pending` et retire un nœud inutilisé depuis 5 minutes.

## Alternatives écartées

- **Taille fixe** : gaspille la RAM hors événement, ou sature pendant.
- **Karpenter** : pas de provider pour Proxmox.
- **Scaling manuel** : oublis fréquents, pas de réaction à une pointe.

## Conséquences

- Un scale-up prend plusieurs minutes (clone de VM, boot Talos, join) : le lancement d'une instance peut être lent le temps d'un ajout de nœud.
- Les bornes doivent rester cohérentes avec la RAM de l'hôte : voir [Scaling](../architecture/scaling.md).
- Alertes dédiées : [autoscaling](../runbooks/autoscaling.md).
