# netbird-sync

**Couche** : Applications CTF · **Où** : pod du cluster (namespace `netbird-sync`) · **Version** : image `0.1.0` ; Go 1.26, controller-runtime v0.25.2

## À quoi elle sert ici et pourquoi ce choix

Les instances ne sont joignables que par VPN. Ce petit contrôleur fait trois choses :

1. il surveille les Services `LoadBalancer` des namespaces `inst-*` et crée dans NetBird la **ressource** (l'IP /32 de l'instance) et la **policy** qui l'ouvre au groupe `ctf-team-<id>` de l'équipe ;
2. il **rattache les joueurs à ce groupe** : il lit les membres de l'équipe dans CTFd (endpoint interne du plugin [pad_teams](ctfd-plugin-pad-teams.md), jeton `PAD_INTERNAL_TOKEN`), les rapproche des utilisateurs NetBird
   **par e-mail** et aligne les pairs du groupe (ajoute les nouveaux, retire ceux qui ont quitté l'équipe), à chaque réconciliation d'un Service et toutes les minutes (`--membership-interval`) ;
3. il **refuse de fonctionner tant qu'une policy NetBird active a le groupe « All » en source** (typiquement la policy `Default`) : au démarrage il sort en erreur (`refus de démarrer`), ensuite il n'écrit plus rien.
   Sans cela, l'isolation par équipe serait vaine.

Il supprime tout à la disparition de l'instance.

## Où elle tourne et comment elle est déployée

Application `gitops/apps/netbird-sync` : un Deployment, ClusterRole en lecture sur `services`/`namespaces` et `patch` sur `services` (finalizer ; une ValidatingAdmissionPolicy le limite aux namespaces `inst-*` et au seul finalizer `pad.io/netbird-sync` : ni create ni delete, spec/labels/annotations/ownerReferences intouchables), Service de métriques, ServiceMonitor, NetworkPolicy
(sortie vers l'API NetBird et vers CTFd). Réconciliation complète toutes les 10 minutes (`--resync=10m`), membres des équipes toutes les minutes (`--membership-interval=1m`).

## Version épinglée

Image `.../pad/netbird-sync:0.1.0` dans `gitops/apps/netbird-sync/deployment.yaml` ; dépendances Go exactes dans `apps/netbird-sync/go.mod`.

## Fichiers de configuration dans le dépôt

- `apps/netbird-sync/` : `main.go`, `internal/controller/service.go` (réconciliation, garde-fou `GuardOpenPolicies`), `internal/controller/membership.go` (rattachement des joueurs), `internal/netbird/` (client d'API, membres), `internal/ctfd/` (client CTFd), tests.
- `gitops/apps/netbird-sync/` : `deployment.yaml`, `rbac.yaml`, `networkpolicy.yaml`, `servicemonitor.yaml`, `secret.example.yaml`.
- Variables : `NETBIRD_API_URL`, `NETBIRD_API_TOKEN`, `CTFD_URL`, `PAD_INTERNAL_TOKEN`, `NETBIRD_NETWORK_NAME` (`pad-instances`), `NETBIRD_TEAM_GROUP_PREFIX` (`ctf-team-`), `INSTANCES_NAMESPACE_PREFIX` (`inst-`).
- **Secret partagé** : `PAD_INTERNAL_TOKEN` doit être identique dans `ctfd-secrets` et dans le secret `netbird-sync`. `task secrets:init` le génère une fois et le recopie ([Secrets](../architecture/secrets.md)).

## Interactions avec les autres briques

Lit l'API Kubernetes (Services d'instance et label `pad.io/team` du namespace, posé par le [scénario](chall-manager-scenario.md)) ; lit les membres d'équipe dans [CTFd](ctfd.md) ; écrit dans l'API de [NetBird](netbird.md) ; alerte via [VictoriaMetrics](victoriametrics.md).
Le plugin [pad_teams](ctfd-plugin-pad-teams.md) expose l'endpoint interne de résolution des membres d'équipe. Le joueur doit avoir un compte NetBird (SSO Authentik) dont l'e-mail est celui de son compte CTFd, et un pair enrôlé.

## Sécurité

- Finalizer `pad.io/netbird-sync` : la policy NetBird est retirée **avant** la disparition du Service.
- Jeton d'API NetBird dans un Secret SOPS ; compte de service dédié `netbird-sync` créé par la stack `40-netbird`, au rôle `network_admin` (moindre privilège : groupes, networks, policies, pairs). Le PAT se crée à la main (voir [Actions manuelles](../operations/actions-post-deploiement.md)).
- Refus de démarrer (et d'écrire) tant qu'une policy « All » est active : la suppression de la policy `Default` est vérifiée par le code et non plus seulement par la procédure.
- Le jeton interne ne donne accès qu'à la lecture des membres d'équipe ; l'ingress administratif de CTFd refuse cet endpoint.
- `runAsNonRoot` (UID 65532), `readOnlyRootFilesystem`, `drop: ALL` ; NetworkPolicy.

## Supervision

Métriques `netbird_sync_reconcile_total`, `netbird_sync_reconcile_errors_total`, `netbird_sync_team_member_changes_total` (pairs ajoutés ou retirés) et `netbird_sync_open_policies` (policies « All » actives, doit rester à 0) ;
alertes `NetbirdSyncErrors`, `NetbirdSyncDeploymentDown` : [netbird-sync](../runbooks/netbird-sync.md).

## Opérations courantes

```bash
cd apps/netbird-sync && go vet ./... && go test ./...
kubectl -n netbird-sync logs deploy/netbird-sync --tail=50
```

## Pièges connus

- Un namespace d'instance sans label `pad.io/team` est en erreur de réconciliation.
- Un joueur n'entre dans `ctf-team-<id>` que s'il a enrôlé un pair NetBird **avec le même e-mail** que son compte CTFd : sinon rien n'est rattaché (voir le runbook).
- `PAD_INTERNAL_TOKEN` différent entre CTFd et netbird-sync : erreurs HTTP 401 sur la lecture des membres, aucune synchronisation.

## Documentation officielle

[docs.netbird.io/api](https://docs.netbird.io/api) · [book.kubebuilder.io](https://book.kubebuilder.io/)

[Retour à l'index des composants](index.md){ .md-button }
