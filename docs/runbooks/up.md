# Up : déployer la plateforme

`task up` reconstruit tout de zéro et est **idempotent** : on peut le relancer après une interruption. Cette page
détaille chaque phase, ses vérifications et sa reprise. Pour la première fois, lire d'abord
[Démarrage rapide](../demarrage-rapide.md).

## Avant de lancer

- [ ] `nix develop` actif, `task secrets:check` affiche `OK`.
- [ ] `secrets/site.sops.yaml` renseigné ([Valeurs de site](../reference/site.md)) ; hôte Proxmox vierge ou sans conflit de VMID ni de bridge avec le contrat.
- [ ] Jeton API Proxmox dans `secrets/proxmox.sops.yaml`, accès SSH à l'hôte.
- [ ] Docker local démarré (cluster `kind` du bootstrap).
- [ ] Les clés privées age sont sauvegardées hors machine.

## Les phases de `task up`

| # | Phase | Commande seule | Vérification | Reprise |
|---|---|---|---|---|
| 1 | Réseau de l'hôte | `task tofu:apply-stack STACK=00-host-network` | `ip -d link show vmbr2` sur l'hôte | rejouable |
| 2 | Réglages de l'hôte | `task ansible:host` | ARC ZFS plafonné, exporters actifs | rejouable |
| 3 | Routeur OPNsense | `task tofu:apply-stack STACK=10-router` | la VM 200 répond sur `10.20.10.1` | voir note ci-dessous |
| 4 | Image Talos | `task tofu:apply-stack STACK=15-talos-image` | template de VM créé | rejouable |
| 5 | Règles de pare-feu | `task tofu:apply-stack STACK=60-opnsense-rules` | règles préfixées `pad` dans OPNsense | rejouable |
| 6 | LXC de services | `task tofu:apply-stack STACK=20-services-lxc` | `pct list` : 5 LXC | rejouable |
| 7 | Services (Docker Compose) | `task ansible:services` | `docker compose ps` sain dans chaque LXC | rejouable |
| 8 | Authentik | `task tofu:apply-stack STACK=30-authentik` | les applications OIDC existent | rejouable |
| 9 | Cluster | `task bootstrap:cluster` | `kubectl get nodes` : tous Ready | reprenable, voir [Bootstrap](../architecture/bootstrap.md) |
| 10 | ArgoCD | `task bootstrap:gitops` | Applications Synced/Healthy | idempotent |
| 11 | NetBird | `task tofu:apply-stack STACK=40-netbird` | groupes et networks créés | nécessite le PAT (voir ci-dessous) |
| 12 | Warpgate | `task tofu:apply-stack STACK=50-warpgate` | rôles et targets créés | nécessite le jeton Warpgate |
| 13 | DNS | `task tofu:apply-stack STACK=70-dns` | enregistrements publiés | rejouable |
| 14 | Smoke tests | `task verify` | tout `OK` | rejouable |

!!! note "Amorçage de NetBird et Warpgate"
    Les stacks 40 et 50 exigent un jeton créé *après* le premier déploiement du service correspondant. Le premier
    `task up` s'arrêtera donc à ces étapes : créer les jetons, les placer dans `secrets/netbird-tofu.sops.yaml` et
    `secrets/warpgate-tofu.sops.yaml`, puis relancer `task up`. Voir
    [Actions manuelles](../operations/actions-post-deploiement.md).

!!! note "OPNsense au premier boot"
    L'import de configuration d'OPNsense simule des frappes clavier pendant une fenêtre de temps (best-effort). S'il
    échoue, appliquer la procédure manuelle de 1 minute décrite dans `infra/opnsense/README.md`, puis relancer.

## Après `task up`

1. Faire les [actions manuelles](../operations/actions-post-deploiement.md).
2. `task verify` depuis un poste connecté à NetBird.
3. `task backup` pour disposer d'un premier point de restauration.
4. Ouvrir Grafana et vérifier que les quatre dashboards se remplissent.

## Dépannage

| Symptôme | Piste |
|---|---|
| `tofu` : erreur d'authentification Proxmox | jeton API ou permissions : `sops secrets/proxmox.sops.yaml` |
| Ansible : hôte injoignable | clés SSH, `ssh_host` et `ssh_user` de `secrets/site.sops.yaml`, route vers la zone MGMT |
| `bootstrap:cluster` bloqué sur `Provisioned` | `kubectl --kubeconfig <kind> -n pad-cluster describe machine` ; API Proxmox joignable ? |
| ArgoCD en `ksops` / `no identity matched` | Secret `sops-age`, voir [Secrets](../SECRETS.md) |
| Applications `Progressing` longtemps | images en cours de tirage ; `kubectl get pods -A` ; [Charges Kubernetes](kubernetes-workloads.md) |
