# KEDA

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `keda`) · **Version** : chart 2.21.0

## À quoi elle sert ici et pourquoi ce choix

Les `ScaledObject` font varier les replicas de CTFd et du front selon le CPU **et** une métrique métier lue dans VictoriaMetrics (utilisateurs actifs pour CTFd, sessions
actives pour le front). Ainsi la capacité suit la charge réelle d'un événement. Vue d'ensemble : [Scaling](../architecture/scaling.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/keda` (sync-wave -3), un réplica de l'opérateur, du serveur de métriques et des webhooks.

## Version épinglée

Chart `keda` 2.21.0 dans `gitops/platform/keda/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/keda/values.yaml`.
- `gitops/apps/ctfd/scaledobject.yaml` : 2 à 4 replicas, CPU 70 %, `max(ctfd_active_users{window="5m"})` seuil 100.
- `gitops/apps/frontend/scaledobject.yaml` : 2 à 4 replicas, CPU 70 %, `max(pad_frontend_active_sessions{app="pad-frontend"})` seuil 150.
- `gitops/apps/chall-manager/scaledobject.yaml` : 1 à 1 (CPU seul, instance unique voulue).

## Interactions avec les autres briques

Interroge [VictoriaMetrics](victoriametrics.md) (`10.20.50.10:8428`, flux de la matrice) et pilote les Deployments de [CTFd](ctfd.md), du [front](frontend.md) et de [chall-manager](chall-manager.md).

## Sécurité

Conteneurs bornés (requests/limits), logs JSON ; la requête de scaling est en lecture seule sur VictoriaMetrics.

## Supervision

Alertes `KedaScalerErrors`, `HpaMaxedOut` : [Autoscaling](../runbooks/autoscaling.md) ; dashboard `pad-capacity`.

## Opérations courantes

```bash
kubectl get scaledobjects -A
kubectl get hpa -A
```

## Pièges connus

Les gauges sont identiques sur chaque pod : les requêtes utilisent `max()`, jamais `sum()`, sinon le nombre de replicas multiplierait la métrique et ferait osciller le scaling.

## Documentation officielle

[keda.sh/docs](https://keda.sh/docs/)

[Retour à l'index des composants](index.md){ .md-button }
