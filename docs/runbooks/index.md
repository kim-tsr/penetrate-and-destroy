# Runbooks

Un runbook décrit quoi faire quand quelque chose casse ou doit être fait avec méthode. Chaque alerte de la
supervision renvoie à l'un d'eux par son annotation `runbook_url` : `docs/runbooks/<nom>.md`.

## Procédures

| Procédure | Quand |
|---|---|
| [Up](up.md) | déployer, ou reprendre un déploiement interrompu |
| [Destroy](destroy.md) | supprimer la plateforme (tout sauf l'hôte) |
| [Rebuild](rebuild.md) | détruire puis reconstruire, chronométré |
| [Sauvegarde et restauration](backup-restore.md) | avant une opération risquée, après un incident de données |
| [Incident générique](incident.md) | une panne dont on ne connaît pas encore la cause |
| [Rotation des secrets](rotation-secrets.md) | rotation planifiée, ou fuite suspectée |

## Alertes

| Runbook | Alertes |
|---|---|
| [Notifications Alertmanager](alertmanager-notifications.md) | `AlertmanagerNotificationsFailing` |
| [Télémétrie Alloy](alloy-telemetry.md) | `AlloyRemoteWriteFailing`, `AlloyLogsDropped`, `ClusterMetricsMissing` |
| [ArgoCD](argocd.md) | `ArgoCDOutOfSync`, `ArgoCDAppUnhealthy`, `ArgoCDSyncFailed` |
| [Authentik](authentik.md) | `AuthentikServerErrors` |
| [Autoscaling](autoscaling.md) | `KedaScalerErrors`, `HpaMaxedOut`, `ClusterAutoscaler*` |
| [Certificats](certificates.md) | `CertExpiry`, `CertExpiryCritical`, `CertManagerCertExpiry`, `CertManagerCertNotReady` |
| [CrowdSec](crowdsec.md) | `CrowdSecAlertsBurst`, `CrowdSecDecisionsHigh`, `CrowdSecNoMetrics` |
| [CTFd](ctfd.md) | `CtfdDeploymentDown`, `CtfdMetricsMissing`, `CtfdMetricsStale`, `CtfdIncorrectSubmissionsBurst`, `CtfEventPaused` |
| [Docker dans un LXC](docker-lxc.md) | `DockerDaemonDown`, `DockerHealthchecksFailing` |
| [Front](frontend.md) | `FrontendHigh5xxRatio`, `FrontendCtfdSlow`, `FrontendMetricsMissing` |
| [Disque saturé](host-disk.md) | `DiskFull`, `DiskCritical`, `DiskWillFillIn24h` |
| [CPU, mémoire, horloge](host-resources.md) | `HighMemory`, `HighCpu`, `OomKillDetected`, `ClockSkew` |
| [Ingress](ingress.md) | `IngressHigh5xxRatio`, `IngressHighLatency` |
| [Cible injoignable](instance-down.md) | `InstanceDown` |
| [Instances de challenges](instances.md) | `ChallManagerDeploymentDown`, `ChallManagerErrorRate`, `CtfdInstancesDrift` |
| [Nœuds Kubernetes](kubernetes-nodes.md) | `KubeNodeNotReady`, `KubeNodePressure` |
| [Charges Kubernetes](kubernetes-workloads.md) | `KubePodCrashLooping`, `KubePodNotReady`, `KubeDeployment*`, `KubePodOOMKilled`, `KubePersistentVolumeFillingUp` |
| [Kyverno](kyverno.md) | `KyvernoPolicyViolations`, `KyvernoMetricsMissing` |
| [Pile de supervision](monitoring-stack.md) | `VmalertRuleErrors`, `VmalertNotifierErrors`, `LokiServerErrors` |
| [netbird-sync](netbird-sync.md) | `NetbirdSyncErrors`, `NetbirdSyncDeploymentDown` |
| [OPNsense indisponible](opnsense-down.md) | `OpnsenseDown` |
| [Invité Proxmox arrêté](proxmox-guest-down.md) | `PveGuestDown` |
| [Hôte Proxmox](proxmox-host.md) | `PveNodeDown`, `PveHostMemoryHigh` |
| [Stockage Proxmox](proxmox-storage.md) | `PveStorageHigh`, `PveStorageCritical`, `ZfsPoolNotOnline`, `ZfsArcHitRatioLow` |
| [Watchdog](watchdog.md) | `Watchdog` |

## Conventions de commande

Les commandes des runbooks supposent :

=== "Cluster Kubernetes"

    ```bash
    # depuis la racine du dépôt, sur le poste opérateur ou le bastion
    export KUBECONFIG="$PWD/.state/kubeconfig"
    export TALOSCONFIG="$PWD/.state/talosconfig"
    task bootstrap:kubeconfig      # régénère les fichiers s'ils manquent
    ```

=== "Hôte et LXC"

    On entre sur l'hôte Proxmox en SSH (ou à la console), puis dans un LXC avec
    `pct enter <vmid>`. Le staff peut aussi passer par le bastion Warpgate.

    | Machine | vmid | IP | Répertoire Compose |
    |---|---|---|---|
    | OPNsense (VM) | 200 | `10.20.10.1` | - |
    | edge | 210 | `10.20.20.10` | `/opt/pad/edge` |
    | netbird | 211 | `10.20.20.11` | `/opt/pad/netbird` |
    | warpgate | 230 | `10.20.30.10` | `/opt/pad/warpgate` |
    | authentik | 240 | `10.20.40.10` | `/opt/pad/authentik` |
    | monitoring | 250 | `10.20.50.10` | `/opt/pad/monitoring` |

    ```bash
    docker compose --project-directory /opt/pad/monitoring ps
    ```

=== "Requêtes sur les métriques"

    ```bash
    curl -s -G http://10.20.50.10:8428/api/v1/query --data-urlencode 'query=up == 0'
    ```

!!! warning "Les correctifs du cluster passent par Git"
    ArgoCD écrase toute modification manuelle (`selfHeal`). Les commandes `kubectl` des runbooks servent à
    **diagnostiquer** ; pour corriger durablement, on modifie `gitops/` et on pousse.

## Écrire ou modifier un runbook

Chaque alerte doit avoir `runbook_url: docs/runbooks/<nom-en-kebab>.md`. Pour lister ce que les alertes attendent :

```bash
python3 monitoring/scripts/validate.py runbooks
```

Structure d'un runbook d'alerte : symptômes, alertes concernées, diagnostic (commandes), remédiation, escalade.
