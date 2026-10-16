# Up : déployer la plateforme

`task up` enchaîne les **phases 0 à 12** et est **idempotent** : on peut le relancer après une interruption, il reprend en rejouant chaque phase
(les étapes déjà faites ne changent rien). Chaque phase se joue aussi seule et se termine par une vérification `OK`/`KO`.
Le pas à pas complet (préparation de l'hôte, comptes, secrets, commandes, vérifications, erreurs) est dans le
**[Guide de déploiement](../guide-deploiement.md)** ; cette page est l'aide-mémoire de reprise.

## Avant de lancer

- [ ] `nix develop` actif, `TF_VAR_state_passphrase` exporté, `SOPS_AGE_KEY_FILE` défini.
- [ ] `task phase:0-prereqs` sans `KO` (outils, secrets, accès à l'hôte, privilèges du jeton Proxmox).
- [ ] Docker local démarré (cluster `kind` du bootstrap).
- [ ] Clés age et phrase secrète des states sauvegardées hors machine.

## Les phases

| Phase | Tâche | Vérification seule | Reprise |
|---|---|---|---|
| 0 | `task phase:0-prereqs` | `task check:0-prereqs` | lecture seule |
| 1 | `task phase:1-reseau` (00-host-network, `ansible:host`) | `task check:1-reseau` | rejouable |
| 2 | `task phase:2-routeur` (10-router, route de l'hôte, 60-opnsense-rules) | `task check:2-routeur` | rejouable ; import OPNsense manuel si besoin (`infra/opnsense/README.md`) |
| 3 | `task phase:3-image-talos` | `task check:3-image-talos` | rejouable |
| 4 | `task phase:4-lxc` | `task check:4-lxc` | rejouable |
| 5 | `task phase:5-dns` | `task check:5-dns` | rejouable |
| 6 | `task phase:6-services-1` (monitoring, authentik, edge) | `task check:6-services-1` | rejouable |
| 7 | `task phase:7-identite` (30-authentik, `secrets:oidc-sync`) | `task check:7-identite` | rejouable ; depuis le bastion/mgmt |
| 8 | `task phase:8-services-2` (warpgate, netbird, monitoring) | `task check:8-services-2` | rejouable |
| 9 | `task phase:9-cluster` | `task check:9-cluster` | reprenable, voir [Bootstrap](../architecture/bootstrap.md) |
| 10 | `task phase:10-gitops` | `task check:10-gitops` | idempotent ; exige tout commité et poussé |
| 11 | `task phase:11-acces` (NetBird, 40-netbird, 50-warpgate) | `task check:11-acces` | exige les PAT créés à la main |
| 12 | `task phase:12-verify` | `task check:12-verify` | rejouable |

`task status` indique quelles phases semblent faites ; `task status -- --live` rejoue les vérifications. `task plan:<stack>` montre ce qu'un `apply` changerait.

!!! info "Pourquoi les services sont déployés en deux passes"
    Les secrets des clients OIDC de NetBird, Warpgate et Grafana sont **générés par la stack `30-authentik`** (phase 7), qui exige elle-même Authentik et l'edge en ligne.
    Les rôles NetBird et Warpgate refusent de s'exécuter sans ces secrets : la phase 6 déploie donc monitoring, Authentik et l'edge, la phase 7 applique `30-authentik` et recopie
    les secrets dans les sops (`scripts/sopsctl.py oidc-sync`, sans jamais les afficher), la phase 8 déploie Warpgate, NetBird et rejoue le monitoring. Les rôles sont idempotents.
    Les secrets du front et d'ArgoCD sont recopiés dans `gitops/` : les **commiter et les pousser avant la phase 10**.

!!! note "Les arrêts normaux d'un premier `task up`"
    Les phases 10 et 11 s'arrêtent tant que le dépôt n'est pas poussé (10) ou que les jetons NetBird/Warpgate n'existent pas (11) : c'est volontaire. Créer ce qu'elles
    réclament (guide, phases 8 et 11 ; [Actions manuelles](../operations/actions-post-deploiement.md)), puis relancer `task up` ou la phase.

## Après le déploiement

1. Faire les [actions manuelles](../operations/actions-post-deploiement.md) restantes.
2. `task phase:12-verify` depuis un poste connecté à NetBird.
3. `task backup` pour disposer d'un premier point de restauration.
4. Parcourir la checklist finale du guide, puis ouvrir Grafana et vérifier que les dashboards se remplissent.

## Dépannage

| Symptôme | Piste |
|---|---|
| un `KO` | la ligne `à regarder` de la vérification dit où chercher ; corriger puis relancer la même phase |
| `tofu` : erreur d'authentification Proxmox | jeton et privilèges : `task check:0-prereqs` |
| Ansible : hôte injoignable | clés SSH, `ssh_host`/`ssh_user` de `secrets/site.sops.yaml`, route de l'hôte (`task host:route`) |
| `bootstrap:cluster` bloqué sur `Provisioned` | `kubectl --kubeconfig .state/kind.kubeconfig -n pad-cluster describe machine` ; API Proxmox joignable ? |
| ArgoCD en `ksops` / `no identity matched` | Secret `sops-age`, voir [Secrets](../SECRETS.md) |
| Applications `Progressing` longtemps | images à tirer ou empreintes `000…` ; `kubectl get pods -A` ; [Charges Kubernetes](kubernetes-workloads.md) |
