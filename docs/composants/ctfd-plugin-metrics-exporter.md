# Plugin CTFd metrics_exporter

**Couche** : Applications CTF · **Où** : dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) · **Version** : version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## À quoi elle sert ici et pourquoi ce choix

Expose l'état du jeu (utilisateurs, équipes, utilisateurs actifs, solves, soumissions, first bloods, état de l'événement, instances actives) pour les dashboards, les alertes et **le scaling KEDA**.

## Où elle tourne et comment elle est déployée

Chargé par CTFd ; le jeton `PAD_METRICS_TOKEN` est un Secret ; la valeur est mise en cache 15 s dans le cache partagé (`PAD_METRICS_CACHE_SECONDS`).

## Version épinglée

version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt

## Fichiers de configuration dans le dépôt

`apps/ctfd/plugins/metrics_exporter/__init__.py` ; `gitops/apps/ctfd/servicemonitor.yaml` ; tests `test_metrics_exporter.py`.

## Interactions avec les autres briques

Scrapé par [Alloy](alloy.md) (ServiceMonitor) vers [VictoriaMetrics](victoriametrics.md) ; `ctfd_active_users` pilote [KEDA](keda.md).

## Sécurité

Authentification Bearer (`PAD_METRICS_TOKEN`) ; 503 si non configuré (fail closed) ; aucune donnée personnelle dans les labels.

## Supervision

Alertes `CtfdMetricsMissing`, `CtfdMetricsStale` : [CTFd](../runbooks/ctfd.md) ; dashboard `pad-live-ctf`.

## Opérations courantes

```bash
bash apps/ctfd/scripts/test.sh                 # harnais pytest CTFd officiel (PAD_LINT_FULL=1 via scripts/lint.sh)
kubectl -n ctfd logs deploy/ctfd | grep pad.   # journaux des plugins
```

## Pièges connus

Les valeurs sont identiques sur tous les pods : agréger avec `max()` (jamais `sum()`).

## Documentation officielle

Contrat d'API : [API des plugins CTFd](../reference/api-plugins.md) (source : `apps/ctfd/API.md`) · [Plugins CTFd](https://docs.ctfd.io/docs/plugins/overview)

[Retour à l'index des composants](index.md){ .md-button }
