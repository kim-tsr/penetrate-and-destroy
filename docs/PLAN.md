# PenetrateAndDestroy : plateforme CTF jetable, de bout en bout (IaC + manifests + ArgoCD)

## Contexte
On construit une plateforme CTF complète, jetable et reconstructible, sur un hôte Proxmox VE unique. Les valeurs propres à l'hôte
(URL de l'API, accès SSH, IP publique, passerelle, MAC) ne sont pas dans le repo : l'opérateur les fournit dans
`secrets/site.sops.yaml` (chiffré SOPS, modèle `secrets/site.example.yaml`).

Exigences :
- tout en IaC, avec des manifests Kubernetes déployés par ArgoCD et des builds reproductibles ;
- une architecture **jetable et reconstructible** avec une seule commande ;
- des zones réseau derrière un routeur, un VPN NetBird, un bastion Warpgate et un IdP ;
- un cluster Kubernetes de prod qui scale avec le nombre de joueurs ;
- CTFd en moteur headless derrière un **front Next.js entièrement sur mesure**, avec un espace joueur et un portail manager ;
- des challenges instanciés par équipe ;
- une supervision complète ;
- une documentation finale.

Décisions validées par l'utilisateur :
- les services d'infra tournent en **LXC** (OPNsense et Talos restent des VMs) ;
- le monorepo est **`kim-tsr/penetrate-and-destroy`** (GitHub), destiné à devenir **public** : projet perso présenté publiquement, mais plateforme pleinement utilisable. Aucun secret ni identifiant d'infra réel dans le repo ;
- le front est public et les challenges ne sont joignables que via NetBird ;
- le front est en Next.js et CTFd tourne en headless ;
- les challenges sont instanciés par équipe.

## Décisions d'architecture (ADR résumées)
| Sujet | Choix | Justification |
|---|---|---|
| Routeur / firewall | **OPNsense** en VM | Segmentation inter-zones, IDS Suricata, exporter Prometheus. Le bootstrap passe par l'import d'un `config.xml` templaté au boot, puis les règles sont gérées par le provider tofu `browningluke/opnsense`. |
| IdP | **Authentik** | Flows personnalisables (auto-inscription des joueurs avec captcha et vérification d'email, invitations staff). Outpost forward-auth pour les apps sans OIDC (VictoriaMetrics, Alertmanager, Hubble). Provider Terraform officiel et blueprints, donc 100 % IaC. Intégrations documentées avec NetBird, Warpgate, Grafana, ArgoCD et Proxmox. Zitadel est plus léger et excellent en multi-tenant B2B, mais on n'a pas besoin du multi-org et il est plus pauvre en forward-auth et en flows. |
| IaC hyperviseur | OpenTofu + `bpg/proxmox` | Bridges, VMs, LXC et téléchargement des images épinglées par checksum (pas besoin de Packer). Le state est chiffré nativement par OpenTofu. |
| OS Kubernetes | **Talos Linux** (schematic Image Factory avec qemu-guest-agent) | Immuable, API-only, sans SSH : idéal pour du jetable. |
| Cycle de vie du cluster | **Cluster API** (CAPMOX + CABPT/CACPPT), **auto-hébergé** | Le bootstrap se fait dans un cluster `kind` éphémère, puis `clusterctl move` transfère la gestion dans le cluster de prod lui-même. On n'a pas de cluster de management permanent, et on économise environ 6 Go de RAM. |
| Scaling des nœuds | cluster-autoscaler (provider clusterapi) sur la MachineDeployment `challenges` | Ajoute ou retire des VMs Talos selon les pods en attente. |
| GitOps | **ArgoCD dans le cluster de prod**, en apps-of-apps et ApplicationSets | Tout ce qui tourne dans Kubernetes est déclaré en manifests ou en Helm dans le repo. Aucun `kubectl apply` manuel en dehors du bootstrap. |
| Secrets | SOPS + age (ksops dans ArgoCD, `community.sops` dans Ansible, provider `carlpett/sops` dans tofu) | Commités **chiffrés** dans Git (décision du lot 1). Deux recipients : clé opérateur (tout) et clé cluster (`gitops/**` uniquement). Rien en clair. Voir `docs/SECRETS.md`. |
| CNI | Cilium (sans kube-proxy, LB-IPAM, policies L3/L7, Hubble, WireGuard) | Isolation des instances de challenges entre elles. |
| Stockage | Proxmox CSI plugin (ZFS) et Garage (S3) pour les uploads CTFd et les sauvegardes | |
| Base de données | mariadb-operator (MariaDB, la DB officielle de CTFd) et Valkey | |
| Instancier | **chall-manager** (ctfer-io) : scénarios Kubernetes, TTL, OTel, API | Le front l'appelle via le BFF. |
| Registry | Zot avec scan Trivy et signature cosign (politique Kyverno `verifyImages`) | |
| Policies | Kyverno : PSS restricted sur les namespaces de challenges, verifyImages, labels obligatoires | |

## Budget de ressources cible (8 vCPU en surcommit, environ 26 Go de RAM)
| Composant | Type | vCPU | RAM |
|---|---|---|---|
| OPNsense | VM | 2 | 1,5 Go |
| edge (Traefik + CrowdSec) | LXC | 1 | 512 Mo |
| netbird (management, signal, relay, coturn) | LXC | 1 | 1 Go |
| warpgate | LXC | 1 | 256 Mo |
| authentik (avec PostgreSQL ; plus de Redis depuis 2025.10) | LXC | 2 | 1,5 Go |
| monitoring (VictoriaMetrics, Loki, Tempo, Grafana, Alertmanager, Uptime Kuma) | LXC | 2 | 3 Go |
| Talos, control plane | VM ×1 | 2 | 2,5 Go |
| Talos, workers `platform` | VM ×2 | 2 | 3,5 Go chacun |
| Talos, workers `challenges` | VM, autoscalés de 1 à 3 | 2 | 2,5 Go chacun |

Le total va d'environ 17 Go (minimum) à 22 Go (maximum). Une tâche Ansible sur l'hôte limite l'ARC ZFS à 4 Go. Les bornes min et max de l'autoscaler sont des variables, et la doc explique comment les ajuster selon les ressources de l'hôte.

## Réseau
Un bridge `vmbr2` VLAN-aware, sans uplink, est routé uniquement par OPNsense. `vmbr1` ne sert que de transit en mode WAN `nat`.

| VLAN | Zone | CIDR | Contenu |
|---|---|---|---|
| WAN | `vmbr0` | IP publique | Mode `routed_ip` (recommandé) : IP publique supplémentaire routée vers la VM OPNsense, avec une MAC dédiée si l'hébergeur l'exige. Mode `nat` : réseau de transit `vmbr1` 10.255.0.0/30, avec un DNAT nftables sur l'hôte des ports 443 et NetBird vers OPNsense. IP, passerelle et MAC viennent de `secrets/site.sops.yaml`. |
| 10 | MGMT | 10.20.10.0/24 | Interface d'admin OPNsense, endpoint Proxmox (si routé), runners CI éventuels |
| 20 | DMZ | 10.20.20.0/24 | LXC edge, LXC netbird |
| 30 | BASTION | 10.20.30.0/24 | LXC warpgate |
| 40 | IDENTITY | 10.20.40.0/24 | LXC authentik |
| 50 | MONITORING | 10.20.50.0/24 | LXC monitoring |
| 60 | PROD | 10.20.60.0/24 | Control plane Talos, workers platform, pool LB Cilium pour l'ingress |
| 70 | CHALLENGES | 10.20.70.0/24 | Workers challenges, routing peer NetBird, pool LB Cilium pour les instances |

Matrice de flux (deny all par défaut, journalisée) :
- **Internet → DMZ :** 443 et ports NetBird uniquement.
- **DMZ (edge) → PROD :** ingress uniquement.
- **DMZ (edge) → IDENTITY :** 443 uniquement.
- **Joueurs NetBird → CHALLENGES :** IPs LB des instances uniquement. Un contrôleur `netbird-sync` crée une resource et une policy par instance et par équipe, en phase 2.
- **Staff NetBird → BASTION uniquement.**
- **BASTION → toutes les zones :** SSH, HTTPS, API kube (6443) et API Talos (50000).
- **Toutes les zones → MONITORING :** push uniquement.
- **MONITORING → toutes les zones :** scrape uniquement.
- **PROD → API Proxmox :** pour CAPMOX et le CSI.
- **CHALLENGES → \* :** refusé, sauf l'API kube et la DNS interne ; egress internet uniquement par allowlist de challenge.

## Structure du repo
```
penetrate-and-destroy/
  flake.nix (devshell épinglé), Taskfile.yml, .sops.yaml, renovate.json, README.md
  infra/
    tofu/modules/{proxmox-network,lxc-service,talos-image,opnsense-vm}
    tofu/stacks/{00-host-network,10-router,20-services-lxc,30-authentik,40-netbird,50-warpgate,60-opnsense-rules,70-dns}
    opnsense/ (config.xml.tmpl + génération de l'ISO d'import)
    ansible/ (inventaires générés par tofu ; rôles host-tuning, base-hardening, edge-traefik-crowdsec, netbird-server, warpgate, authentik, monitoring-stack, alloy)
  bootstrap/ (config kind, clusterctl init, manifests CAPI du cluster prod, script pivot)
  gitops/
    bootstrap/ (Application root : apps-of-apps)
    clusters/prod/ (Cluster, TalosControlPlane, MachineDeployments platform et challenges, gérés par ArgoCD après le pivot)
    platform/ (cilium, cert-manager, traefik, keda, cluster-autoscaler, capi-providers, proxmox-csi, mariadb-operator, valkey, garage, zot, kyverno, alloy, external-dns, sealed-config ksops)
    apps/ (ctfd, frontend, chall-manager, netbird-sync)
  apps/
    frontend/ (Next.js App Router + TS + Tailwind/shadcn + BFF)
    ctfd/ (Dockerfile épinglé, plugins sso-bridge, metrics-exporter, chall-manager-bridge)
    netbird-sync/ (petit contrôleur Go)
  challenges/ (schéma challenge.yml étendu, 3 exemples : web instancié, pwn instancié, crypto statique)
  monitoring/ (dashboards JSON, règles d'alerte et de recording)
  docs/ (MkDocs Material : architecture, ADR, réseau, runbooks, guide manager, guide joueur)
  .github/workflows/ (lint, tofu plan, kubeconform, build reproductible + SBOM + cosign, e2e)
```

## `task up` : reconstruction complète
1. `00-host-network` crée `vmbr2`, et le rôle Ansible host-tuning configure l'ARC ZFS et nftables (le DNAT de repli).
2. `10-router` crée la VM OPNsense avec l'ISO de config, puis `60-opnsense-rules` pose la matrice de flux.
3. `20-services-lxc` crée les LXC, puis Ansible y déploie en Docker Compose, avec des images épinglées par digest, une première passe (monitoring, authentik, edge).
4. `30-authentik` configure en tofu les applications, providers, groupes et flows (OIDC pour NetBird, Warpgate, Grafana, ArgoCD, front et Proxmox) et **génère** les secrets des clients OIDC ; `scripts/sopsctl.py oidc-sync` les recopie dans les sops, puis Ansible déploie la seconde passe (warpgate, netbird, rejeu de monitoring).
5. `bootstrap/` lance kind, puis `clusterctl init` et la création du cluster Talos, puis `clusterctl move` dans la prod. ArgoCD est installé et l'Application root est appliquée.
6. ArgoCD synchronise la plateforme, puis les apps, puis les manifests de son propre cluster CAPI.
7. `40-netbird` et `50-warpgate` créent les groupes, policies, routes et targets. `70-dns` crée les enregistrements.

Les autres commandes :
- `task destroy` supprime toutes les ressources sauf l'hôte.
- `task rebuild` enchaîne destroy puis up.
- `task backup` et `task restore` sauvegardent et restaurent MariaDB et Garage vers un S3 externe optionnel.

## Scaling
- **CTFd et front :** un seul `ScaledObject` KEDA par Deployment, avec deux triggers (CPU + métrique applicative : `pad_frontend_active_sessions` pour le front, sessions actives pour CTFd). KEDA génère l'HPA, pas d'HPA séparé.
- **chall-manager :** `ScaledObject` KEDA.
- **Instances :** une ResourceQuota et un LimitRange par instance, avec un TTL.
- **Nœuds :** cluster-autoscaler sur le pool `challenges`, de 1 à 3.
- **Validation :** un test de charge k6.

## Supervision
Alloy, sur chaque LXC et en DaemonSet, envoie :
- les métriques vers VictoriaMetrics ;
- les logs vers Loki ;
- les traces vers Tempo.

Exporters : node, pve-exporter, OPNsense, CrowdSec, Authentik, NetBird, Warpgate, MariaDB, Valkey, Traefik, Cilium et Hubble, et un exporter CTFd maison (users, solves, first bloods, instances).

Dashboards versionnés :
- plateforme ;
- live CTF ;
- sécurité ;
- capacité du cluster et de l'hôte.

Alertmanager notifie sur Discord et par e-mail. Uptime Kuma fournit les sondes externes.

## Front Next.js
- **Design distinctif** (skill frontend-design) : identité « PenetrateAndDestroy », esthétique terminal/ops, sombre.
- **Auth :** OIDC Authentik via Auth.js. Les rôles viennent des groupes `ctf-players`, `ctf-managers` et `ctf-admins`.
- **BFF :** les route handlers du serveur appellent l'API CTFd avec un token par utilisateur, émis par le plugin `sso-bridge`. Ce plugin provisionne l'utilisateur et est protégé par un secret partagé et une NetworkPolicy. Aucun token CTFd ne transite par le navigateur.
- **Espace joueur :**
  - dashboard ;
  - challenges par catégorie, avec statut ;
  - soumission de flag ;
  - instances : lancer, prolonger, arrêter, avec un compte à rebours et le rappel NetBird ;
  - scoreboard live (SSE) avec graphe ;
  - gestion d'équipe ;
  - notifications ;
  - profil ;
  - onboarding NetBird.
- **Portail manager :**
  - upload d'un ZIP avec `challenge.yml` (format ctfcli étendu) : validation, fichiers vers Garage, images vers Zot, création dans CTFd et du scénario dans chall-manager ;
  - mode Git : synchronisation via la CI ctfcli ;
  - test d'instance ;
  - gestion de l'événement (dates, freeze) ;
  - modération ;
  - statistiques par challenge.

## Plan d'exécution par sous-agents
- **Vague 0 (moi) :** squelette du repo, conventions, `flake.nix`, `Taskfile`, `infra/contracts.yaml` (CIDR, IPs, noms DNS, groupes, ports : la source unique que tous les agents consomment), puis création du repo GitHub.
- **Vague 1 (5 agents en parallèle, worktrees isolés) :**
  1. tofu : hôte, réseau, OPNsense, LXC et règles ;
  2. Ansible : services LXC ;
  3. bootstrap CAPI/Talos et plateforme GitOps ;
  4. CTFd, plugins, chall-manager, netbird-sync et challenges d'exemple ;
  5. front Next.js : joueur, manager, BFF et Playwright.
- **Vague 2 :**
  - configuration Authentik, NetBird et Warpgate via tofu ;
  - dashboards et alertes ;
  - CI ;
  - revue sécurité croisée.
- **Vague 3 :** documentation MkDocs (diagrammes, ADR, matrice de flux, runbooks up/destroy/rebuild/incident, guides manager et joueur), puis vérification.
- **Déploiement réel :** avec l'utilisateur. Une **confirmation explicite** est demandée avant toute action sur l'hôte (réseau, VMs).

## Prérequis à fournir (avant le déploiement, pas avant le code)
0. Un hôte Proxmox vierge, ou sans conflit de VMID ni de bridge avec le contrat (`infra/contracts.yaml`).
1. Les valeurs de site dans `secrets/site.sops.yaml` : URL de l'API Proxmox, adresse et utilisateur SSH de l'hôte, IP publique, passerelle et MAC si nécessaire (`task secrets:pending` liste ce qui manque).
2. Un token API Proxmox (privilèges VM, LXC, stockage et réseau), ainsi que sudo pour l'utilisateur SSH ou une clé root pour le rôle host-tuning (ARC ZFS, nftables).
3. Un domaine, et un token API OVH DNS pour cert-manager et external-dns.
4. Une IP publique supplémentaire routée vers la VM routeur (sinon, mode `nat` : DNAT de l'hôte).
5. Un webhook Discord et un SMTP.
6. `gh` authentifié pour créer `kim-tsr/penetrate-and-destroy`.

## Vérification
- **CI :**
  - `tofu validate` et `tofu plan` ;
  - `ansible-lint` ;
  - `kubeconform` et `kustomize`/`helm template` sur `gitops/` ;
  - `next build`, lint et tests ;
  - Trivy et checkov.
- **Local :** un docker-compose e2e (CTFd, front, Authentik, mock de chall-manager) et Playwright (login, flag, scoreboard, upload manager).
- **Serveur :**
  - `task up` de bout en bout et toutes les Applications ArgoCD Synced/Healthy ;
  - SSO sur chaque app ;
  - via NetBird : instance joignable ; sans NetBird : instance injoignable ;
  - matrice de flux testée par nmap depuis chaque zone ;
  - k6 pour valider le scale des pods puis des nœuds ;
  - `task rebuild` chronométré ;
  - dashboards alimentés et alerte de test reçue.

## Avancement

### Lot 1, terminé
Après les vagues 0, 1 et la majeure partie de la vague 2, le lot 1 a complété :

| Domaine | Livré | Validation |
|---|---|---|
| tofu | stacks `40-netbird` (groupes, networks `pad-instances` et `pad-bastion`, policy staff vers bastion, utilisateur de service netbird-sync) et `50-warpgate` (rôles, targets SSH/HTTP) ; noms techniques ajoutés au contrat | `tofu validate` vert avec des providers compilés depuis les sources (registry bloqué) ; lock files à générer |
| monitoring | `monitoring/` : 4 dashboards, 67 alertes, 23 recording rules, Alertmanager (Discord, e-mail, Watchdog vers Uptime Kuma), sondes Uptime Kuma déclaratives ; branché dans le rôle `monitoring-stack` | `monitoring/scripts/check.sh` vert (promtool, amtool, vmalert) |
| gitops socle | ServiceMonitors de tous les composants, netpol de scrape Alloy, scrape direct du kubelet, PodMonitor Zot ; `root` synchronise désormais les 18 composants (5 avant) ; Applications `capi-providers` et `cluster-prod` ; sourceRepos complets | kustomize + kubeconform verts ; `helm template` sur les 11 charts |
| ops | `task backup`/`restore` (MariaDB + Garage, S3 externe optionnel), confirmation forte de `task destroy`, e2e docker-compose, k6, CI (gitleaks, checkov, actionlint, trivy secrets) | actionlint, shellcheck, `k6 inspect` ; pile e2e jamais démarrée (pas de Docker) |
| secrets | chaîne SOPS/ksops complète, `task secrets:{keys,init,pending,check,rotate-cluster-key}`, CI à clé éphémère, `scripts/check-sops.sh`, `.gitleaks.toml` | bout en bout avec une clé jetable |
| front | Next.js complet : espace joueur, portail manager, BFF, DA « salle d'opérations », Dockerfile, gitops (ScaledObject unique) | lint, typecheck, 152 tests vitest, build, 18 parcours Playwright en mode mock |
| CTFd | plugin `pad_public` (événement, first bloods), modération dans `manager_api` avec journal d'audit ; `API.md` à jour ; correctif : CTFd 3.8 n'authentifie `Authorization: Token` que sur les requêtes JSON | 71 tests pytest sur un vrai CTFd 3.8.8 |

**Écarts par rapport au plan d'origine**
- Authentik tourne sans Redis, conforme à l'upstream depuis 2025.10.
- La configuration OIDC de Warpgate reste côté Ansible : le provider tofu ne gère pas les fournisseurs SSO.
- L'IdP de NetBird est configuré par Ansible. Le stack tofu l'a, mais désactivé par défaut.
- Le bucket de sauvegarde de CTFd s'appelle `backups`.

**TODO ouverts (actions manuelles et vérifications sur cluster réel)**
- Supprimer la policy NetBird « Default » (All ↔ All). Créer le PAT de netbird-sync. Ajouter les règles OPNsense des routing peers.
- Générer les `.terraform.lock.hcl` (`task tofu:lock`) et le `flake.lock` sur une machine qui a accès aux registries.
- Clés S3 de CTFd : faire lire des clés fournies en sops par le Job `garage-init`, au lieu de les recopier à la main.
- Collecter les blocages OPNsense dans Loki (syslog) ; vérifier les noms de métriques NetBird et CrowdSec ; exposer Alertmanager derrière le forward-auth.
- Valider sur un vrai cluster : chart Alloy 1.13.1 et certificats kubelet, labels Zot, adoption SSA des objets CAPI par ArgoCD, téléchargement de ksops par l'initContainer, image du front.
- Calibrer le seuil KEDA du front avec k6 ; publier le statut de synchro Git consommé par le front (`PAD_GIT_SYNC_STATUS_URL`).

### Lot 2 : valeurs de site en entrées chiffrées, terminé
- Le contrat ne porte ni IP publique, ni passerelle, ni URL d'API, ni nom d'hôte. Ces valeurs sont des entrées chiffrées (`secrets/site.sops.yaml`, créé par `task secrets:init`, listé par `task secrets:pending`), lues par tofu, Ansible et les scripts.
- Nœud Proxmox par défaut `pve` ; `task site:node -- <nom>` met à jour le contrat et les manifests marqués `# contracts: host.node`.
- Mode WAN générique `routed_ip` | `nat`. Prérequis : un hôte Proxmox vierge ou sans conflit de VMID ni de bridge avec le contrat.
- Licence MIT ; garde-fou `scripts/check-site-leaks.sh` (lint et CI), qui compare des empreintes sha256 sans republier les motifs interdits.

### Lot 3 : durcissement face aux joueurs (revue de sécurité, findings 3 à 6 et 10)
- **Déni de service** : ResourceQuota et LimitRange générés par Kyverno sur chaque `inst-*` (ephemeral-storage compris), plafonds par conteneur dans le scénario (cpu 2, mémoire 1Gi, éphémère 1Gi), kubelet du pool challenges (`podPidsLimit` 256, `maxPods` 40), plus aucun egress DNS (tunnel DNS) ; DNS limité à `cluster.local` en opt-in.
- **Images** : registre `registry.pad.internal/ctf/` et empreinte `@sha256` obligatoires (schéma, scénario, Kyverno `restrict-instance-images`) ; `verify-images` en Enforce piloté par le ConfigMap `pad-image-policy` (Audit tant que la clé cosign est factice) ; images ctfd, frontend et netbird-sync par empreinte. Voir `docs/operations/images-signees.md`.
- **Noyau** : `hostUsers: false` (user namespaces, feature gate kubelet), RuntimeClass gVisor optionnelle (`PAD_RUNTIME_CLASS`).
- **Flux** : I3 asymétrique, 6443 limité aux workers challenges (stack `60-opnsense-rules`).
- **NetBird** : entrée des instances limitée au routing peer (plus d'overlay), rattachement automatique des joueurs à `ctf-team-<id>` par netbird-sync, refus de démarrer tant que la policy Default existe, PAT `network_admin` pour netbird-sync et `auditor` pour le front.
- **Socle** : PSS et NetworkPolicy pour les namespaces CAPI, `pad-cluster` et `csi-proxmox` ; clé S3 de sauvegarde dédiée (optionnelle) dans Garage.
- **Raccordements faits ensuite** : `scripts/sopsctl.py` copie `PAD_INTERNAL_TOKEN` de CTFd vers le secret netbird-sync, génère la clé de sauvegarde Garage avec `--all` et recopie les secrets OIDC (`oidc-sync`) ; `scripts/backup.sh`/`restore.sh` utilisent la clé dédiée quand elle existe (repli sur la clé principale) ; `task up` déploie les services en deux passes autour de `30-authentik`.
- **À faire (hors périmètre du lot)** : identifiants de pull Zot (`pad-pull`) sur les nœuds challenges, à poser par `talosctl` (action manuelle 8 ; règle `ctf/**` et Secret `argocd-oidc` faits : sops + ksops, alimenté par `oidc-sync`) ; vérifier sur cluster réel `UserNamespacesSupport` sous Talos, les motifs DNS Cilium, le rôle `network_admin` NetBird et la syntaxe keyless de Kyverno.

### Prochain lot
1. Revue de sécurité croisée.
2. Documentation MkDocs : architecture, ADR, matrice de flux, runbooks (dont les 24 référencés par les alertes), guides joueur et manager, procédure du repo privé de challenges.
3. Réécriture de l'historique avec `git filter-repo`, puis force-push après confirmation explicite. L'utilisateur passe ensuite le repo en public.
