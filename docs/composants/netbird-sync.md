# netbird-sync

**Couche** : Applications CTF · **Où** : pod du cluster (namespace `netbird-sync`) · **Version** : image `0.1.0` ; Go 1.26, controller-runtime v0.25.2

## À quoi elle sert ici et pourquoi ce choix

Les instances ne sont joignables que par VPN. Ce petit contrôleur surveille les Services `LoadBalancer` des namespaces `inst-*` et crée dans NetBird la **ressource** (l'IP /32 de l'instance) et la **policy**
qui l'ouvre au groupe de l'équipe. Il supprime tout à la disparition de l'instance.

## Où elle tourne et comment elle est déployée

Application `gitops/apps/netbird-sync` : un Deployment, ClusterRole en lecture sur `services`/`namespaces` et `patch` sur `services` (finalizer), Service de métriques, ServiceMonitor. Réconciliation complète toutes les 10 minutes (`--resync=10m`).

## Version épinglée

Image `.../pad/netbird-sync:0.1.0` dans `gitops/apps/netbird-sync/deployment.yaml` ; dépendances Go exactes dans `apps/netbird-sync/go.mod`.

## Fichiers de configuration dans le dépôt

- `apps/netbird-sync/` : `main.go`, `internal/controller/service.go` (réconciliation), `internal/netbird/client.go` (client d'API), tests.
- `gitops/apps/netbird-sync/` : `deployment.yaml`, `rbac.yaml`, `networkpolicy.yaml`, `servicemonitor.yaml`, `secret.example.yaml`.
- Variables : `NETBIRD_API_URL`, `NETBIRD_API_TOKEN`, `NETBIRD_NETWORK_NAME` (`pad-instances`), `NETBIRD_TEAM_GROUP_PREFIX` (`ctf-team-`), `INSTANCES_NAMESPACE_PREFIX` (`inst-`).

## Interactions avec les autres briques

Lit l'API Kubernetes (Services d'instance et label `pad.io/team` du namespace, posé par le [scénario](chall-manager-scenario.md)) ; écrit dans l'API de [NetBird](netbird.md) ; alerte via [VictoriaMetrics](victoriametrics.md).
Le plugin [pad_teams](ctfd-plugin-pad-teams.md) expose l'endpoint interne de résolution des membres d'équipe.

## Sécurité

- Finalizer `pad.io/netbird-sync` : la policy NetBird est retirée **avant** la disparition du Service.
- Jeton d'API NetBird dans un Secret SOPS ; compte de service dédié créé par la stack `40-netbird`.
- `runAsNonRoot` (UID 65532), `readOnlyRootFilesystem`, `drop: ALL` ; NetworkPolicy.

## Supervision

Métriques `netbird_sync_reconcile_total` et `netbird_sync_reconcile_errors_total` ; alertes `NetbirdSyncErrors`, `NetbirdSyncDeploymentDown` : [netbird-sync](../runbooks/netbird-sync.md).

## Opérations courantes

```bash
cd apps/netbird-sync && go vet ./... && go test ./...
kubectl -n netbird-sync logs deploy/netbird-sync --tail=50
```

## Pièges connus

Un namespace d'instance sans label `pad.io/team` est en erreur de réconciliation. Le joueur doit appartenir au groupe NetBird `ctf-team-<id>` (voir le runbook).

## Documentation officielle

[docs.netbird.io/api](https://docs.netbird.io/api) · [book.kubebuilder.io](https://book.kubebuilder.io/)

[Retour à l'index des composants](index.md){ .md-button }
