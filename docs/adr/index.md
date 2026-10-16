# Décisions d'architecture (ADR)

Chaque page décrit une décision structurante : le contexte, ce qui a été retenu, les alternatives écartées et les conséquences. Les décisions ont été validées au lancement du projet ; le tableau de synthèse est aussi dans le [plan](../PLAN.md).

| # | Sujet | Choix |
|---|---|---|
| 1 | [Routeur et pare-feu : OPNsense en VM](001-routeur-opnsense.md) | OPNsense (VM, 2 vCPU, 1,5 Go) |
| 2 | [Fournisseur d'identité : Authentik](002-idp-authentik.md) | Authentik, avec PostgreSQL, en LXC |
| 3 | [IaC de l'hyperviseur : OpenTofu et bpg/proxmox](003-iac-hyperviseur.md) | OpenTofu >= 1.10 et provider `bpg/proxmox` |
| 4 | [Système du cluster : Talos Linux](004-talos.md) | Talos Linux avec un schematic Image Factory (qemu-guest-agent) |
| 5 | [Cycle de vie du cluster : Cluster API auto-hébergé](005-cluster-api.md) | Cluster API (CAPMOX, CABPT, CACPPT, IPAM in-cluster), auto-hébergé |
| 6 | [Autoscaling des nœuds : cluster-autoscaler](006-autoscaling-noeuds.md) | cluster-autoscaler (provider clusterapi) sur la MachineDeployment `challenges` |
| 7 | [GitOps : ArgoCD dans le cluster de production](007-gitops-argocd.md) | ArgoCD en apps-of-apps et ApplicationSets |
| 8 | [Secrets : SOPS et age](008-secrets-sops.md) | SOPS + age, ksops, `community.sops`, `carlpett/sops` |
| 9 | [CNI : Cilium](009-cilium.md) | Cilium sans kube-proxy, LB-IPAM, policies L3/L7, Hubble, WireGuard |
| 10 | [Stockage : Proxmox CSI et Garage](010-stockage.md) | Proxmox CSI (ZFS) pour les volumes, Garage (S3) pour les objets |
| 11 | [Bases de données : MariaDB et Valkey](011-bases-de-donnees.md) | mariadb-operator (MariaDB) et Valkey |
| 12 | [Instanciation des challenges : chall-manager](012-chall-manager.md) | chall-manager (ctfer-io) avec un scénario Kubernetes générique |
| 13 | [Registry d'images : Zot](013-registry-zot.md) | Zot avec scan Trivy et signature cosign |
| 14 | [Politiques d'admission : Kyverno](014-kyverno.md) | Kyverno |

## Décisions transverses

- **Source unique** : toute IP, nom, port ou groupe vient de `infra/contracts.yaml` ([contrat](../reference/contrat.md)).
- **Versions épinglées exactement** : providers, charts et collections ; images par digest.
- **Pas d'action manuelle sur le serveur** : après le bootstrap, tout passe par ArgoCD.
- **Le front est public, les challenges ne sont joignables que par NetBird.**
- **CTFd en headless** derrière un front Next.js sur mesure.
