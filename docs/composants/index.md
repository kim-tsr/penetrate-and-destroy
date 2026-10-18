# Composants

Cette section documente **chaque brique technologique** de la plateforme, une page par brique, avec la même structure :
à quoi elle sert ici et pourquoi ce choix, où elle tourne, version épinglée (et où), fichiers de configuration, interactions, sécurité,
supervision, opérations courantes, pièges connus et lien vers la documentation officielle. Pour le récit de bout en bout, commencer par
[Comment tout fonctionne](../fonctionnement.md) ; pour les décisions, voir les [ADR](../adr/index.md).

!!! tip "Lire cette documentation en local"
    ```bash
    task docs:serve    # aperçu sur http://127.0.0.1:8000, rechargement automatique
    task docs:build    # mkdocs build --strict (identique à la CI), sortie dans site/
    ```
    Les deux tâches créent le venv `.venv-docs` et y installent `docs/requirements.txt` (versions exactes) s'il est absent ou périmé.
    Sans `task` : `python3 -m venv .venv-docs && .venv-docs/bin/pip install -r docs/requirements.txt && .venv-docs/bin/mkdocs serve`.

Les versions viennent du dépôt (contrat, `versions.yml`, `Chart`, `package.json`...) ; le chemin exact est donné dans chaque page.
Renovate les maintient à jour ([page](renovate-dependabot.md)).

## Hyperviseur et réseau

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [Proxmox VE](proxmox-ve.md) | Hyperviseur : VM, LXC, stockage ZFS, bridges | hôte bare metal (le seul serveur) | 9.x (prérequis, non piloté par le dépôt) |
| [OpenTofu](opentofu.md) | Infrastructure as code déclarative (9 stacks) | poste opérateur et CI (jamais sur le serveur) | >= 1.10.0 (version du devshell Nix) |
| [Provider bpg/proxmox](tofu-bpg-proxmox.md) | Crée bridges et VLAN, LXC (Debian 13, non privilégiés, nesting et keyctl pour Docker), la VM OPNsense et le template Talos, et télécharge les images avec vérification de checksum | poste opérateur (via [OpenTofu](opentofu.md)) | 0.116.1 |
| [Provider browningluke/opnsense](tofu-opnsense.md) | Gère toute la matrice de flux d'OPNsense (règles « automation » évaluées en premier, blocage par défaut intégré d'OPNsense, journalisé, en fin de chaîne) | poste opérateur (via [OpenTofu](opentofu.md)) | 0.26.0 |
| [Provider goauthentik/authentik](tofu-authentik.md) | Déclare dans Authentik les groupes du contrat, les providers OAuth2 et applications (un par client OIDC), les flows d'inscription joueur et staff, les stages (captcha, e-mail, mot de passe) et le provider proxy (forward-auth) des interfaces internes | poste opérateur (via [OpenTofu](opentofu.md)) | 2026.8.0 |
| [Provider netbirdio/netbird](tofu-netbird.md) | Configure NetBird : groupes, networks (`pad-instances`, `pad-bastion`), routing peers, clés d'installation, connecteur d'identité Authentik, utilisateur de service pour netbird-sync et policy staff vers bastion | poste opérateur (via [OpenTofu](opentofu.md)) | 0.0.10 |
| [Provider warp-tech/warpgate](tofu-warpgate.md) | Crée dans Warpgate un rôle par groupe d'accès (défaut `infra-admins`) et les cibles SSH (LXC, OPNsense, hôte) et HTTP (UI OPNsense, UI Proxmox), rattachées à ces rôles | poste opérateur (via [OpenTofu](opentofu.md)) | 1.2.0 |
| [Provider ovh/ovh](tofu-ovh.md) | Publie les enregistrements DNS A publics (front, auth, vpn, status) vers l'IP WAN de la plateforme | poste opérateur (via [OpenTofu](opentofu.md)) | 2.22.0 |
| [Provider carlpett/sops](tofu-sops.md) | Lit les fichiers `* | poste opérateur (via [OpenTofu](opentofu.md)) | 1.4.1 |
| [Ansible](ansible.md) | Configure l'hôte Proxmox et déploie les services Docker Compose des LXC | poste opérateur (connexion SSH vers l'hôte et les LXC) | collections épinglées (voir ci-dessous) ; ansible du devshell |
| [OPNsense](opnsense.md) | Routeur, pare-feu inter-zones, DNS interne, IDS | VM Proxmox (VMID 200, 2 vCPU, 1,5 Go) | 25.7 (image nano épinglée par sha256) |

## Services LXC

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [Traefik (edge)](traefik-edge.md) | Reverse proxy public, TLS, bouncer CrowdSec | LXC `edge` (zone DMZ, 10.20.20.10) | v3.7.15 (image épinglée par digest) |
| [CrowdSec](crowdsec.md) | Détection de comportements, bannissement, WAF (AppSec) | LXC `edge` (Docker Compose, avec Traefik) | v1.8.1 (image épinglée par digest) |
| [NetBird](netbird.md) | VPN WireGuard des joueurs et du staff | LXC `netbird` (zone DMZ, 10.20.20.11) + routing peers | serveur 0.81.0, dashboard v2.95.0 (digests épinglés) |
| [Warpgate](warpgate.md) | Bastion SSH/HTTPS du personnel, avec audit | LXC `warpgate` (zone BASTION, 10.20.30.10) | 0.29.2 (image épinglée par digest) |
| [Authentik](authentik.md) | Fournisseur d'identité OIDC unique (SSO) | LXC `authentik` (zone IDENTITY, 10.20.40.10) | 2026.8.4 (image) ; PostgreSQL 16.15 |
| [Docker et Compose (dans les LXC)](docker-lxc.md) | Runtime des services d'infrastructure hors Kubernetes | chaque LXC de services (edge, netbird, warpgate, authentik, monitoring) | docker-ce 5:29.9.1, containerd 2.4.2, compose 5.6.0 |

## Observabilité

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [VictoriaMetrics et vmalert](victoriametrics.md) | Base de séries temporelles, scraping, règles d'alerte | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | v1.154.0 (victoria-metrics et vmalert, digests épinglés) |
| [Loki](loki.md) | Stockage et requêtes des logs | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | 3.7.8 (image épinglée par digest) |
| [Tempo](tempo.md) | Stockage des traces distribuées (OTLP) | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | 3.1.0 (image épinglée par digest) |
| [Grafana](grafana.md) | Tableaux de bord et exploration | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | 13.2.4 (image épinglée par digest) |
| [Alertmanager](alertmanager.md) | Routage, regroupement et inhibition des alertes | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | v0.34.1 (image épinglée par digest) |
| [Uptime Kuma](uptime-kuma.md) | Sondes externes, page de statut publique, dead-man's switch | LXC `monitoring` (zone MONITORING, 10.20.50.10), Docker Compose | 2.5.6 (image épinglée par digest) |
| [Grafana Alloy](alloy.md) | Agent de collecte : métriques, logs, traces | hôte Proxmox et chaque LXC (paquet apt), DaemonSet dans le cluster | 1.20.1 (paquet `1.20.1-1`, image `v1.20.1`, chart 1.13.1) |
| [Exporters (node, pve, kube-state-metrics, Docker)](exporters.md) | Sources de métriques de l'infrastructure | hôte, LXC et cluster | node-exporter v1.12.1 (cluster), kube-state-metrics v2.20.0, pve-exporter (PyPI, épinglé) |

## Cluster Kubernetes

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [Talos Linux](talos.md) | Système d'exploitation immuable des nœuds Kubernetes | VM Proxmox (control plane en zone PROD, workers PROD et CHALLENGES) | v1.11.6 (Kubernetes v1.34.1) |
| [Cluster API (core)](cluster-api.md) | Cycle de vie déclaratif du cluster (Cluster, Machine, MachineDeployment) | pods du cluster `pad-prod` (auto-hébergé) ; kind pendant le bootstrap | v1.14.3 (contrat v1beta2) |
| [CAPMOX (provider Proxmox)](capmox.md) | Provider d'infrastructure Cluster API pour Proxmox | pods du cluster (namespace des providers CAPI) | v0.9.1 (contrat v1beta2) |
| [CABPT et CACPPT (providers Talos)](cabpt-cacppt.md) | Génération de la configuration Talos et gestion du control plane | pods du cluster | CABPT v0.6.13, CACPPT v0.5.14 (contrat v1beta1) |
| [IPAM in-cluster (Cluster API)](ipam-in-cluster.md) | Allocation d'adresses IP statiques aux machines | pods du cluster | v1.1.1 |
| [kind (bootstrap)](kind.md) | Cluster de bootstrap éphémère pour créer pad-prod | poste opérateur (Docker requis), le temps de `bootstrap:cluster` | kind v0.33.0, nœud kindest/node:v1.34.11@sha256 |
| [cluster-autoscaler](cluster-autoscaler.md) | Ajoute et retire des workers du pool challenges | pod du cluster (pool platform) | chart 9.53.0 |
| [Cilium et Hubble](cilium-hubble.md) | CNI, remplacement de kube-proxy, LoadBalancer, chiffrement, observabilité réseau | DaemonSet sur tous les nœuds + operator, Hubble relay et UI | chart 1.20.3 |
| [Proxmox CCM](proxmox-ccm.md) | Initialisation des nœuds : providerID CAPMOX, labels de topologie, retrait du taint uninitialized | pod du cluster sur le control plane (namespace `csi-proxmox`) | chart proxmox-cloud-controller-manager 0.2.32 (v0.16.1) |
| [Proxmox CSI](proxmox-csi.md) | Volumes persistants sur ZFS pour Kubernetes | pods du cluster (namespace `csi-proxmox`) ; node plugin sur tous les nœuds | chart proxmox-csi-plugin 0.5.12 |
| [Traefik (cluster)](traefik-cluster.md) | Ingress interne du cluster | pods Traefik (2 replicas, pool platform), IP 10.20.60.200 | chart 42.0.0 |

## Plateforme GitOps

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [ArgoCD](argocd.md) | GitOps : synchronise le cluster avec le dépôt | pods du cluster (namespace `argocd`, pool platform) | chart argo-cd 10.10.5 |
| [SOPS, age et ksops](sops-age-ksops.md) | Secrets chiffrés dans Git, déchiffrés par chaque consommateur | poste opérateur (sops, age), repo-server ArgoCD (ksops), CI (clé éphémère) | ksops v4.5.1 ; sops et age du devshell |
| [cert-manager](cert-manager.md) | Certificats TLS automatisés (ACME DNS-01 et CA interne) | pods du cluster (namespace `cert-manager`) | chart v1.21.2 ; webhook OVH 0.9.18 |
| [Kyverno](kyverno.md) | Politiques d'admission et génération de NetworkPolicy | pods du cluster (namespace `kyverno`, pool platform) | chart 3.9.1 |
| [KEDA](keda.md) | Autoscaling horizontal des applications sur métriques | pods du cluster (namespace `keda`) | chart 2.21.0 |
| [external-dns](external-dns.md) | DNS dynamique pour les Services et Ingress (désactivé par défaut) | pod du cluster (0 réplica tant que non activé) | chart 1.23.0 |
| [mariadb-operator et MariaDB](mariadb.md) | Base de données de CTFd, opérée par un operator | pods du cluster (namespace `ctfd`, StatefulSet), operator dans `mariadb-operator` | operator 26.10.1, MariaDB 10.11.19 |
| [Valkey](valkey.md) | Cache et état partagé (sessions, jetons, verrous) | pod du cluster (namespace `storage`, StatefulSet) | chart 0.12.0, image 9.1.2 |
| [Garage (S3)](garage.md) | Stockage d'objets S3 : fichiers de challenges et sauvegardes | pod du cluster (StatefulSet `garage-0`, namespace `storage`) | v2.4.1 |
| [Zot (registry OCI)](zot.md) | Registry d'images interne avec scan de vulnérabilités | pod du cluster (namespace `registry`), `registry.pad.internal` | chart 0.1.128, image v2.1.22 |
| [cosign et Trivy](cosign-trivy.md) | Signature des images et détection de vulnérabilités | CI (signature, scan), Zot (scan CVE), Kyverno (vérification) | cosign et trivy du devshell (`flake.lock`) ; Trivy DB via Zot |

## Applications CTF

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [CTFd (headless)](ctfd.md) | Moteur de CTF : challenges, équipes, soumissions, scoreboard | pods du cluster (namespace `ctfd`, 2 à 4 replicas) | 3.8.8 (image `ctfd/ctfd` épinglée par digest) + plugins pad_* |
| [Plugin CTFd pad_common](ctfd-plugin-pad-common.md) | Bibliothèque partagée des plugins (auth, rôles, rate limit, audit) | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd sso_bridge](ctfd-plugin-sso-bridge.md) | Pont SSO : identité OIDC vers session API CTFd | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd chall_manager_bridge](ctfd-plugin-chall-manager-bridge.md) | Type de challenge dynamic_instance et API des instances | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd pad_teams](ctfd-plugin-pad-teams.md) | Création, adhésion et sortie d'équipe sûres | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd pad_public](ctfd-plugin-pad-public.md) | Lectures publiques : état de l'événement et first bloods | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd manager_api](ctfd-plugin-manager-api.md) | API du portail manager : import, statistiques, modération, événement | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [Plugin CTFd metrics_exporter](ctfd-plugin-metrics-exporter.md) | Endpoint /metrics au format Prometheus | dans le pod CTFd (plugin chargé depuis `CTFd/plugins/`) | version de l'image CTFd (3.8.8) ; plugin versionné avec le dépôt |
| [chall-manager](chall-manager.md) | Orchestrateur d'instances de challenges | pod du cluster (namespace `chall-manager`, 1 réplica) + CronJob janitor | v0.6.6 (serveur et janitor, digests épinglés) |
| [Scénario Pulumi Go (instance générique)](chall-manager-scenario.md) | Programme qui construit une instance : namespace, pod, Service, NetworkPolicy | binaire exécuté par chall-manager ; publié en OCI dans Zot | scénario `0.1.0` ; Go 1.27.2, Pulumi SDK v3.219.0, SDK chall-manager v0.6.6 |
| [netbird-sync](netbird-sync.md) | Contrôleur : ouvre l'accès NetBird à l'équipe propriétaire de l'instance | pod du cluster (namespace `netbird-sync`) | image `0.1.0` ; Go 1.26, controller-runtime v0.25.2 |
| [Front Next.js (Auth.js et BFF)](frontend.md) | Interface joueur et manager, et BFF devant CTFd | pods du cluster (namespace `frontend`, 2 à 4 replicas) | Next.js 16.4.2, React 19.3.1, next-auth 5.0.0-beta.32 |

## Outillage et CI

| Brique | Rôle | Où elle tourne | Version épinglée |
|---|---|---|---|
| [Nix (devshell)](nix.md) | Environnement de développement reproductible | poste opérateur, CI | nixpkgs 25.05 (figé par `flake.lock`) |
| [Taskfile (go-task)](taskfile.md) | Point d'entrée unique des commandes | poste opérateur, CI | go-task du devshell |
| [GitHub Actions](github-actions.md) | Intégration continue : validations, images signées, documentation | runners GitHub (ubuntu-24.04) | actions épinglées par SHA de commit |
| [Renovate et Dependabot](renovate-dependabot.md) | Mise à jour automatique des versions épinglées | services SaaS (propositions de PR) | configuration `renovate.json` ; `.github/dependabot.yml` |
| [k6 (tests de charge)](k6.md) | Test de charge du front, de CTFd et du cycle d'instance | poste opérateur (idéalement depuis NetBird) | k6 du devshell (`flake.lock`) |
| [Playwright (tests e2e du front)](playwright.md) | Tests de bout en bout du front en mode simulé | poste de dev et CI | @playwright/test 1.64.1 |
| [MkDocs Material (documentation)](mkdocs.md) | Génération du site de documentation | poste de dev et CI | mkdocs 1.6.1, mkdocs-material 9.6.23 |
