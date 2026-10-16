# Cycle de vie d'une instance

Un challenge « instancié » donne à chaque **équipe** (ou à chaque joueur en mode individuel) son propre
environnement, créé à la demande, borné par un TTL et détruit à l'expiration.

## Acteurs

| Acteur | Rôle |
|---|---|
| Front (BFF) | boutons lancer, prolonger, arrêter ; compte à rebours ; rappel NetBird |
| CTFd, plugin `chall_manager_bridge` | API `/api/v1/instances/...` ; quota, cooldown, renouvellements ; identité `team-<id>` ou `user-<id>` |
| chall-manager | exécute le **scénario** (Pulumi, `apps/chall-manager-scenario`) : crée et détruit les ressources Kubernetes |
| Kubernetes + Cilium | namespace `inst-*`, pod, Service `LoadBalancer`, NetworkPolicy ; IP allouée par LB-IPAM |
| netbird-sync | pour chaque Service d'instance, crée la resource et la policy NetBird de l'équipe |
| NetBird + routing peer | route le trafic de l'overlay vers l'IP d'instance, pour l'équipe seulement (groupe `ctf-team-<id>`, alimenté par netbird-sync depuis les membres CTFd) ; le routeur est en masquerade : l'instance ne voit que l'IP du routing peer |

## Séquence

```mermaid
sequenceDiagram
    autonumber
    actor J as Joueur
    participant F as Front (BFF)
    participant C as CTFd chall_manager_bridge
    participant M as chall-manager
    participant K as Kubernetes + Cilium
    participant S as netbird-sync
    participant N as NetBird
    J->>F: Lancer l'instance
    F->>C: POST /api/v1/instances/id
    C->>C: quota (3 par équipe), cooldown (30 s), équipe, pause
    C->>M: crée l'instance (scénario, image, ports, limites, TTL)
    M->>K: namespace inst-..., Deployment, Service LoadBalancer, NetworkPolicy
    K-->>M: IP du pool instances (ex. 10.20.70.101)
    M-->>C: connection_info, until
    C-->>F: 201 Instance (expires_in, renewals_left)
    K-->>S: événement Service LoadBalancer
    S->>C: GET /api/v1/pad/internal/sources/team/id (membres)
    S->>N: groupe ctf-team-id, resource 10.20.70.101/32, policy pad-inst-...
    F-->>J: IP et ports, compte à rebours
    J->>N: connecté au VPN NetBird
    J->>K: nc 10.20.70.101 1337 (via le routing peer)
    Note over C,M: À l'échéance ou sur DELETE : chall-manager détruit le namespace
    K-->>S: Service supprimé (finalizer pad.io/netbird-sync)
    S->>N: supprime la policy et la resource
```

## Garanties

- **Isolement entre instances** : un namespace et une `NetworkPolicy` par instance (ingress depuis le routing peer
  NetBird uniquement, **aucun egress, DNS compris** : pas de tunnel DNS vers Internet), pods en PSS `restricted`
  appliqué par Kyverno. Le DNS limité à `cluster.local` est un opt-in réservé aux admins (`dns=cluster`).
- **Ressources bornées** : Kyverno génère par instance une `ResourceQuota` et un `LimitRange` (CPU, mémoire,
  disque éphémère 256Mi par défaut et 1Gi au plus, 2 pods, 1 Service LoadBalancer) ; le kubelet du pool challenges
  limite à 256 PIDs par pod et 40 pods par nœud (fork bomb, remplissage du disque du worker).
- **Images maîtrisées** : registre `registry.pad.internal/ctf/` et empreinte `@sha256` obligatoires (schéma, scénario
  et Kyverno), signatures cosign vérifiées ([Images signées](../operations/images-signees.md)).
- **Noyau** : `hostUsers: false` (user namespace) par défaut, seccomp `RuntimeDefault`, `drop ALL`, jeton de
  ServiceAccount non monté ; une RuntimeClass gVisor est possible via `PAD_RUNTIME_CLASS` (option, non activée).
  Le noyau reste partagé avec le worker : une évasion reste la menace résiduelle principale.
- **Aucune exposition Internet** : l'IP d'instance est dans la zone CHALLENGES, qui n'a aucune règle entrante depuis
  Internet. Seul NetBird, via le routing peer, y accède, et seulement pour le groupe de l'équipe.
- **Pas de flag dans l'API** : les flags d'instance (mode `per_instance_flag`) ne sont jamais renvoyés au front.
- **Nettoyage** : le finalizer `pad.io/netbird-sync` garantit que la policy NetBird est retirée *avant* la
  disparition du Service. Une réconciliation complète a lieu toutes les 10 minutes.

## Limites et quotas

| Paramètre | Défaut | Variable CTFd |
|---|---|---|
| instances simultanées par équipe | 3 (`instances.max_per_team`) | `PAD_INSTANCES_MAX_PER_SOURCE` |
| instances simultanées sur la plateforme | 90 (`instances.max_total`) | `PAD_INSTANCES_MAX_TOTAL` |
| délai entre deux créations | 30 s | `PAD_INSTANCES_COOLDOWN_SECONDS` |
| TTL d'une instance | 1 h (60 s à 6 h, défini par `instance.ttl`) | `challenge.yml` |
| renouvellements | selon le challenge (`max_renewals`) | API admin |

La limite globale protège le pool LB-IPAM `instances` (100 IP) et les ressources du pool challenges : elle compte les
instances vivantes et les instances préchauffées (`pool_min`) et reste sous la taille du pool pour garder de la marge.
Au-delà, le joueur reçoit un 503 avec un message explicite. Le contrôle est côté CTFd (plugin `chall_manager_bridge`),
non transactionnel : des créations simultanées peuvent dépasser la limite de quelques unités, absorbées par la marge ;
l'alerte `InstancesLBPoolFilling` surveille le remplissage réel du pool.

Les managers et admins contournent quota, cooldown, renouvellements et pause : c'est ce que le portail utilise pour le
[test d'instance](../manager/exploitation-evenement.md).

## Dérive et diagnostic

Deux alertes surveillent ce cycle : `CtfdInstancesDrift` (écart entre les instances connues de CTFd et les namespaces
`inst-*`) et `ChallManagerErrorRate`. Les procédures sont dans [Instances](../runbooks/instances.md) et
[netbird-sync](../runbooks/netbird-sync.md).
