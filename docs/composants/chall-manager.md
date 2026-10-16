# chall-manager

**Couche** : Applications CTF · **Où** : pod du cluster (namespace `chall-manager`, 1 réplica) + CronJob janitor · **Version** : v0.6.6 (serveur et janitor, digests épinglés)

## À quoi elle sert ici et pourquoi ce choix

Crée et détruit, à la demande, l'environnement d'un challenge pour une équipe, avec un TTL. Il exécute un **scénario Pulumi** (le [scénario générique](chall-manager-scenario.md)), ce qui permet des challenges
qui ne sont pas un simple conteneur. Décision : [ADR 12](../adr/012-chall-manager.md).

## Où elle tourne et comment elle est déployée

`gitops/apps/chall-manager` : un Deployment (état Pulumi en backend fichier sur un PVC, plugins et scénarios OCI en cache sur le même volume), un ServiceAccount avec un ClusterRole limité
(namespaces, services, deployments, networkpolicies) et un CronJob **janitor** toutes les minutes qui détruit les instances expirées.

## Version épinglée

Images `docker.io/ctferio/chall-manager:v0.6.6@sha256:...` et `chall-manager-janitor:v0.6.6@sha256:...` dans `gitops/apps/chall-manager/deployment.yaml` ; SDK du scénario `chall-manager/sdk v0.6.6` (`apps/chall-manager-scenario/go.mod`).

## Fichiers de configuration dans le dépôt

- `gitops/apps/chall-manager/` : `deployment.yaml`, `rbac.yaml`, `networkpolicy.yaml`, `scaledobject.yaml`, `secret.example.yaml`, `secret-generator.yaml`.
- Variables du scénario : `PAD_LB_POOL`, `PAD_LB_POOL_LABEL`, `PAD_FROM_CIDRS` (hérités par le programme Pulumi).

## Interactions avec les autres briques

Appelé par le plugin [chall_manager_bridge](ctfd-plugin-chall-manager-bridge.md) ; télécharge le scénario depuis [Zot](zot.md) ; crée les ressources via l'API Kubernetes ; envoie des traces à [Tempo](tempo.md).

## Sécurité

- Seuls les pods du namespace CTFd peuvent l'appeler (NetworkPolicy) ; Swagger désactivé ; `readOnlyRootFilesystem`, `drop: ALL`, `seccomp: RuntimeDefault`.
- Droits RBAC limités aux objets que crée le scénario ; pull du scénario avec un compte registry en lecture seule (`pad-pull`).

## Supervision

Alertes `ChallManagerDeploymentDown`, `ChallManagerErrorRate` : [Instances](../runbooks/instances.md) ; traces OTLP dans Tempo ; dashboard `pad-live-ctf`.

## Opérations courantes

```bash
kubectl -n chall-manager get pods,cronjob
kubectl -n chall-manager logs deploy/chall-manager --tail=50
kubectl get ns | grep '^inst-'
```

## Pièges connus

- Un seul réplica (état Pulumi sur fichier) : le `ScaledObject` est borné à 1.
- Le premier lancement télécharge les plugins Pulumi : prévoir un délai (volume de cache persistant).

## Documentation officielle

[ctfer.io/docs/chall-manager](https://ctfer.io/docs/chall-manager/)

[Retour à l'index des composants](index.md){ .md-button }
