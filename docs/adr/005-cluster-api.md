# ADR 5 : Cycle de vie du cluster : Cluster API auto-hébergé

**Statut** : acceptée.

## Contexte

Un cluster de gestion permanent coûte environ 6 Go de RAM sur un hôte qui n'en a que 31, pour piloter un seul cluster.

## Décision

Le bootstrap crée un cluster **kind éphémère**, installe Cluster API, crée `pad-prod`, puis exécute `clusterctl move` : `pad-prod` devient son propre cluster de gestion et kind est supprimé. Les objets Cluster API vivent ensuite dans `gitops/clusters/prod`, gérés par ArgoCD. Voir [Bootstrap du cluster](../architecture/bootstrap.md).

## Alternatives écartées

- **Cluster de gestion permanent séparé** : cher en RAM et à maintenir pour un seul workload cluster.
- **Terraform + Talos provider direct** : pas de réconciliation continue ni d'autoscaler natif sur les machines.
- **Scripts talosctl** : pas de modèle déclaratif pour ajouter ou retirer des nœuds.

## Conséquences

- Un cluster auto-géré ne peut pas se détruire lui-même : la destruction fait un **pivot inverse** vers un kind frais (`bootstrap/scripts/destroy.sh`).
- ArgoCD est gelé avant le pivot inverse pour ne pas recréer les objets déplacés.
- Le contrat de versions CAPI (v1beta1/v1beta2 selon le provider) doit être suivi à chaque mise à jour.
