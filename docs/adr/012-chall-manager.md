# ADR 12 : Instanciation des challenges : chall-manager

**Statut** : acceptée.

## Contexte

Chaque équipe doit pouvoir lancer sa propre instance d'un challenge, avec TTL, quotas et nettoyage garanti.

## Décision

**chall-manager** expose une API de création/renouvellement/suppression d'instances et exécute des **scénarios** Pulumi. Le scénario générique du dépôt (`apps/chall-manager-scenario`) crée namespace, Deployment, Service `LoadBalancer` et NetworkPolicy à partir de l'image, des ports et des limites du `challenge.yml`. CTFd l'appelle via son plugin `chall_manager_bridge` ; le front passe par CTFd. Voir [Cycle de vie d'une instance](../architecture/instances.md).

## Alternatives écartées

- **Écrire un opérateur maison** : beaucoup de code pour un besoin déjà couvert.
- **CTFd Whale (Docker)** : suppose un démon Docker, pas Kubernetes, et peu d'isolation réseau.
- **Un cluster par équipe** : bien trop coûteux.

## Conséquences

- chall-manager est limité à 1 réplica tant que son stockage est RWO.
- La création d'une instance dépend de la chaîne chall-manager, Cilium puis netbird-sync : voir [Instances](../runbooks/instances.md).
