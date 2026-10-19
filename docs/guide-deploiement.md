# Guide de déploiement de l'opérateur

Ce guide est écrit pour la personne qui **tape les commandes**, une phase après l'autre, en comprenant et en vérifiant chaque étape. Il se
suffit à lui-même : tout ce qu'il faut pour déployer, vérifier, détruire et repartir de zéro est ici, et consultable avec `task docs:serve`.
Pour comprendre ce que la plateforme fait une fois en marche, lire [Comment tout fonctionne](fonctionnement.md) ; pour le détail d'une brique,
la page de la section [Composants](composants/index.md) ; pour une panne, les [runbooks](runbooks/index.md).

!!! info "Principe : une phase = une action + une vérification"
    `task up` n'est que l'enchaînement des **phases 0 à 12**. Chaque phase se joue seule (`task phase:<n>-<nom>`), est **idempotente**
    (on peut la rejouer sans risque), et se termine par une **vérification en lecture seule** qui affiche `OK`, `KO` ou `WARN` et, pour
    chaque `KO`, *quoi regarder*. La même vérification se lance seule : `task check:<n>-<nom>`. `task status` montre où vous en êtes.

| Phase | Tâche | Ce qu'elle fait | Durée indicative |
|---|---|---|---|
| 0 | `phase:0-prereqs` | prérequis du poste, secrets, accès à l'hôte (lecture seule) | 1 min |
| 1 | `phase:1-reseau` | bridges et IP de l'hôte (`00-host-network`), réglages de l'hôte (Ansible) | 5 min |
| 2 | `phase:2-routeur` | VM OPNsense (`10-router`), route de l'hôte, règles de pare-feu (`60-opnsense-rules`) | 15 min |
| 3 | `phase:3-image-talos` | image Talos et template de VM (`15-talos-image`) | 10 min |
| 4 | `phase:4-lxc` | les six LXC de services (`20-services-lxc`) | 10 min |
| 5 | `phase:5-dns` | enregistrements DNS publics (`70-dns`) | 2 min |
| 6 | `phase:6-services-1` | monitoring, Authentik, edge (Ansible, passe 1) | 20 min |
| 7 | `phase:7-identite` | `30-authentik` + recopie des secrets OIDC | 5 min |
| 8 | `phase:8-services-2` | Warpgate, NetBird, Grafana (Ansible, passe 2) | 10 min |
| 9 | `phase:9-cluster` | kind, Cluster API, VMs Talos, Cilium, pivot | 30 à 45 min |
| 10 | `phase:10-gitops` | ArgoCD et Application `root` | 20 à 40 min |
| 11 | `phase:11-acces` | connecteur NetBird, `40-netbird`, `50-warpgate` | 10 min |
| 12 | `phase:12-verify` | smoke tests et rappel des actions manuelles | 3 min |

Les durées dépendent surtout de la bande passante (images Talos, conteneurs) ; le premier déploiement prend en tout 2 à 3 heures,
actions manuelles comprises. Les durées réelles sont à reporter dans [Rebuild](runbooks/rebuild.md) après votre premier essai.

!!! warning "Ordre différent de l'ancien `task up`"
    Les enregistrements DNS publics (phase 5) sont créés **avant** Authentik : la stack `30-authentik` appelle l'API d'Authentik par son nom
    public, et les LXC NetBird et Warpgate vont chercher la découverte OIDC sur ce même nom. Sans DNS, ces étapes échouent.

---

## 1. La machine de l'opérateur

C'est l'ordinateur depuis lequel vous lancez toutes les commandes. Tout le déploiement s'y pilote ; l'hôte Proxmox n'exécute que ce qu'on lui envoie.

### Nix, clonage, shell de travail

```bash
# Nix avec les flakes (si ce n'est pas déjà fait) : https://nixos.org/download
git clone <URL DE VOTRE FORK PRIVÉ> penetrate-and-destroy && cd penetrate-and-destroy
nix develop            # tous les outils aux versions épinglées : task, tofu, ansible, sops, age, kubectl, helm, clusterctl, kind, talosctl...
```

`clusterctl` et `talosctl` sont épinglés par le devshell aux versions du contrat (Cluster API `kubernetes.capi.core`, Talos `kubernetes.talos_version`), comme `kind` ; la phase 0 vérifie qu'elles correspondent.

Deux outils ne viennent pas de Nix : un **démon Docker** local (le cluster `kind` éphémère du bootstrap) et, pour construire l'ISO de
configuration d'OPNsense, `xorriso` (ou `mkisofs`/`genisoimage`) si `nix` n'est pas disponible dans le shell. `task phase:0-prereqs` vérifie tout cela.

!!! danger "Travaillez dans un fork PRIVÉ"
    Le dépôt public ne contient aucune valeur réelle. Votre domaine, votre dépôt et vos secrets chiffrés iront dans **votre** copie. ArgoCD lit
    ce dépôt : tout ce que vous y changez doit être **commité et poussé** avant la phase 10. Ne poussez jamais vos valeurs vers le dépôt public.

### Clés SSH

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pad_admin      # clé d'administration de l'hôte Proxmox
eval "$(ssh-agent)" && ssh-add ~/.ssh/pad_admin  # le provider OpenTofu bpg/proxmox utilise l'AGENT SSH (phase 2)
```

Dans `secrets/proxmox.sops.yaml`, `ssh.ansible_public_key` (injectée dans les LXC, Ansible s'y connecte avec l'agent SSH) et
`ssh.admin_public_keys` (root d'OPNsense) reçoivent **le contenu de `~/.ssh/pad_admin.pub`**. Seule la clé de déploiement GitHub
d'ArgoCD est générée par `task secrets:init`.

### Phrase secrète des states OpenTofu

Chaque stack a un state local chiffré (`.state/tofu/<stack>.tfstate`). La phrase secrète n'est **pas** dans le dépôt :

```bash
mkdir -p ~/.config/pad && chmod 700 ~/.config/pad
( umask 077; openssl rand -base64 32 > ~/.config/pad/state.pass )   # une seule fois ; à sauvegarder hors machine
export TF_VAR_state_passphrase="$(cat ~/.config/pad/state.pass)"      # à refaire dans chaque nouveau shell
```

**Chargement automatique avec direnv (recommandé).** Le fichier `.envrc` du dépôt charge le devshell (`use flake`) et exporte
`TF_VAR_state_passphrase` à chaque entrée dans le dépôt. Il cherche la phrase dans le trousseau macOS (service `tf_passphrase`), sinon dans
`~/.config/pad/state.pass`. Sur macOS, pour la ranger dans le trousseau plutôt que dans un fichier :

```bash
security add-generic-password -a "$USER" -s tf_passphrase -w "$(openssl rand -base64 32)"   # une seule fois
security find-generic-password -s tf_passphrase -w        # l'afficher, pour la sauvegarder hors machine
direnv allow                                              # à la racine du dépôt
```

Surcharges personnelles éventuelles : `.envrc.local` (ignoré par Git). Plus rapide avec `nix-direnv` (cache du devshell).

!!! danger "Perdre cette phrase = perdre les states"
    Sans elle, les states sont illisibles : vous ne pourrez plus détruire proprement ce qu'OpenTofu a créé. Voir « Repartir vraiment de zéro ».

### Accès réseau à l'hôte et aux zones

| Besoin | Depuis le poste | Comment |
|---|---|---|
| API Proxmox (`:8006`) | indispensable dès la phase 0 | joignable directement, ou par `ssh -L 8006:127.0.0.1:8006 <hôte>` avec `proxmox_url` pointant sur `https://127.0.0.1:8006` |
| SSH de l'hôte | indispensable | clé dans l'agent ; utilisateur avec `sudo` sans mot de passe |
| LXC (Ansible) | **automatique** | rebond SSH par l'hôte (`ProxyJump`), rien à configurer ; l'hôte doit router vers les zones (route posée en phase 2) |
| API d'OPNsense (`10.20.10.1`, phase 2) | pour `60-opnsense-rules` | tunnel : `ssh -N -L 8443:10.20.10.1:443 <utilisateur>@<hôte>` puis `export TF_VAR_opnsense_uri=https://127.0.0.1:8443` |
| API Kubernetes (`10.20.60.5:6443`) et API Talos (`:50000`) | phases 9 à 12 | il faut **une route de votre poste vers `10.20.60.0/24`** (voir ci-dessous) |
| API d'administration d'Authentik (phase 7) | **automatique** si le poste joint les zones | OpenTofu (`30-authentik`) joint l'API en interne (`https://<IP du LXC authentik>`, flux M0) ; l'edge refuse l'API d'administration depuis Internet (403). Depuis un autre poste : `-var authentik_api_url=https://auth.<domaine>` depuis la zone bastion/mgmt |

**Joindre les zones depuis le poste (méthode recommandée : VPN maillé WireGuard à routes annoncées).** Pour les phases 2 à 12, la solution la plus simple et la plus
robuste est de faire annoncer `10.20.0.0/16` par l'hôte Proxmox comme sous-réseau d'un VPN maillé. Elle est **indispensable pour `kind` en phases 9 et 10**, car
le trafic sort alors d'un conteneur Docker que ni `sshuttle` ni un tunnel SSH ne couvrent.

1. Sur l'hôte Proxmox : activer le routage (`sysctl -w net.ipv4.ip_forward=1`, rendu persistant dans `/etc/sysctl.d/`), puis
   `<cli-vpn> set --advertise-routes=10.20.0.0/16` (`<cli-vpn>` : la commande de votre VPN maillé). Attention : `--advertise-routes` **remplace** la liste ; si l'hôte annonce déjà d'autres routes, les répéter
   toutes, séparées par des virgules.
2. Dans la console d'administration du VPN : approuver la route annoncée par l'hôte.
3. Sur le poste : `<cli-vpn> set --accept-routes`.
4. Vérifier : `ping 10.20.10.2` (IP mgmt de l'hôte), puis `route -n get 10.20.10.1` (macOS) ou `ip route get 10.20.10.1` (Linux) ; la route doit passer par l'interface du VPN.

Côté OPNsense, ce trafic n'est pas vu comme venant du poste : l'hôte le traduit (SNAT des routes annoncées) vers son IP mgmt (`10.20.10.2`), et la règle **M0** (hôte mgmt vers toutes les zones : SSH, HTTPS, 6443, 50000) l'autorise ; elle sert aussi au rebond SSH d'Ansible vers les LXC.

Cet accès reste l'**accès d'administration de secours**, indépendant de la plateforme : il fonctionne même si celle-ci est cassée. Il ne remplace pas les accès
de la plateforme elle-même (NetBird pour les joueurs et le staff vers les challenges et le bastion, Warpgate pour le SSH tracé du staff). Les autres
options ci-dessous restent valables comme alternatives.

**Alternatives.** `kind` tourne dans Docker sur votre poste et doit parler à l'API du futur cluster (`10.20.60.5`). Le plus simple
est d'exécuter les phases 9 et 10 depuis une machine **déjà dans la zone mgmt** (par exemple un portable branché sur le VLAN de gestion, ou une VM Linux
posée sur `vmbr2` avec une IP de `10.20.10.0/24` et `10.20.10.1` pour passerelle). À défaut, une route statique `10.20.0.0/16` vers l'hôte avec
translation d'adresse (masquerade) sur l'hôte fonctionne si votre poste est sur le même réseau que lui ; un tunnel `sshuttle -r <utilisateur>@<hôte> 10.20.0.0/16`
convient aux commandes lancées depuis le poste lui-même (Ansible, kubectl, curl) mais pas au trafic qui sort d'un conteneur Docker. Ce point
dépend de votre réseau : la vérification de la phase 9 (`API Kubernetes injoignable`) vous dira si c'est en place.

---

## 2. Préparer l'hôte Proxmox

Le dépôt **ne crée pas** l'hôte : il suppose un Proxmox VE 9.x installé, avec un nœud nommé `pve` (autre nom : voir « Personnaliser pour son hôte »).

### 2.1 Version et stockage

```bash
pveversion                       # pve-manager/9.x
pvesm status                     # vos stockages, leur type, leur contenu
```

Il faut **deux stockages** (noms et types dans `infra/contracts.yaml`, bloc `host`) :

| Contrat | Défaut | Rôle | Contenus requis |
|---|---|---|---|
| `host.datastore_vm` + `host.datastore_vm_type` | `local-zfs`, `zfspool` | disques des VM, rootfs des LXC, volumes persistants du CSI | `images`, `rootdir` |
| `host.datastore_iso` | `local` | image OPNsense, template LXC, image Talos | `iso`, `vztmpl`, **`import`** |

Le type `zfspool` est le cas testé ; `lvmthin` et `dir` fonctionnent aussi avec Cluster API et le CSI Proxmox (les disques sont en `raw`
dans tous les cas). Le réglage de l'ARC ZFS du rôle `host-tuning` n'est appliqué que si ZFS est présent (module chargé ou `datastore_vm_type: zfspool`), sans échec sinon.

Pour un `zfspool`, le **dataset ZFS du stockage doit avoir un point de montage** : sans lui, les disques de VM (zvols) fonctionnent mais la création des LXC échoue (les LXC utilisent des datasets montés). La phase 0 le contrôle. À la main :

```bash
grep -A4 'zfspool: local-zfs' /etc/pve/storage.cfg   # ligne « pool » = le dataset
zfs get mountpoint <dataset>                          # « none » ou « legacy » = à corriger
zfs set mountpoint=/<dataset> <dataset>               # ex. zfs set mountpoint=/data/vmdata data/vmdata (réversible)
```

Le contenu `import` du stockage ISO (exigé par la phase 3) est **ajouté automatiquement** par le rôle `host-tuning` en phase 1, en conservant les contenus existants : rien à faire à la main. Le stockage doit être de type fichiers (`dir`, `nfs`...) ; sinon la phase 1 s'arrête en le disant.

### 2.2 Jeton API pour OpenTofu et Cluster API (liste exacte des privilèges)

Le même jeton (`proxmox.api_token` dans `secrets/proxmox.sops.yaml`) sert à OpenTofu (bpg/proxmox) **et** à CAPMOX (Cluster API). Privilèges, déduits des
ressources que les stacks créent et de ce que CAPMOX exige :

| Privilège | Pourquoi |
|---|---|
| `Sys.Modify`, `Sys.Audit` | ponts et VLAN de l'hôte (stack 00), lecture de l'état du nœud |
| `Datastore.Allocate`, `Datastore.AllocateSpace`, `Datastore.AllocateTemplate`, `Datastore.Audit` | disques, téléchargement de l'image OPNsense / du template LXC / de l'image Talos, ISO de configuration |
| `SDN.Use` | brancher VM et LXC sur les bridges `vmbr0`, `vmbr1`, `vmbr2` |
| `VM.Allocate`, `VM.Clone`, `VM.Audit` | créer, cloner (CAPMOX clone le template Talos) et lire VM et LXC |
| `VM.Config.CDROM`, `.CPU`, `.Cloudinit`, `.Disk`, `.HWType`, `.Memory`, `.Network`, `.Options` | configuration complète des VM et LXC (étiquettes, démarrage, réseau, disques) |
| `VM.PowerMgmt` | démarrer, arrêter, redémarrer |
| `VM.Console` | accès console des VM (diagnostic) ; l'import de configuration d'OPNsense passe par la console série, en SSH sur l'hôte |
| `VM.GuestAgent.Audit` | agent invité (adresses IP des VM). Proxmox 9 a supprimé `VM.Monitor` : ne pas l'ajouter (`invalid privilege 'VM.Monitor'`) |

```bash
pveum role add PADInfra -privs "Sys.Modify Sys.Audit Datastore.Allocate Datastore.AllocateSpace Datastore.AllocateTemplate Datastore.Audit SDN.Use VM.Allocate VM.Clone VM.Audit VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.PowerMgmt VM.Console VM.GuestAgent.Audit"
pveum user add pad@pve
pveum acl modify / --users pad@pve --roles PADInfra
pveum user token add pad@pve tofu --privsep 0     # affiche le secret UNE FOIS : le noter
```

La valeur à mettre dans `proxmox.api_token` est `pad@pve!tofu=<secret affiché>`. `task check:0-prereqs` lit les permissions réelles du jeton (`/access/permissions`) et nomme
chaque privilège manquant.

!!! note "Features des LXC : `keyctl` n'est pas posé par le jeton"
    Proxmox réserve à `root@pam` toute feature de conteneur autre que `nesting` (« changing feature flags (except nesting) is only allowed for root@pam »,
    `pve-container`, `check_ct_modify_config_perm`). Un jeton `pad@pve` ne peut donc pas poser `keyctl`, même avec tous les privilèges. Plutôt que de donner un jeton
    `root@pam` à OpenTofu, la stack 20 ne pose que `nesting` (privilège `VM.Allocate`, déjà accordé) et le rôle `host-tuning` pose `keyctl` par `pct set` (SSH sudo sur l'hôte),
    rejoué automatiquement par la phase 4 (`task host:lxc-features`). Si vous avez malgré tout un jeton `root@pam`, rien ne change.

### 2.3 Jeton du CSI Proxmox (volumes persistants)

Le CSI a son propre utilisateur, à privilèges réduits (détails : [Proxmox CSI](composants/proxmox-csi.md)). Le même jeton sert au
cloud controller manager Proxmox ([Proxmox CCM](composants/proxmox-ccm.md)), qui ne fait que lire (`VM.Audit`, `Sys.Audit`) :

```bash
pveum role add CSI -privs "VM.Audit VM.Config.Disk Datastore.Allocate Datastore.AllocateSpace Datastore.Audit Sys.Audit"
pveum user add csi@pve
pveum acl modify / --users csi@pve --roles CSI
pveum user token add csi@pve csi --privsep 0    # le secret va dans gitops/platform/proxmox-csi/secret.sops.yaml (token_secret)
```

Dans ce même fichier, `features.provider` doit valoir `capmox` (valeur du modèle) : c'est le format de providerID de CAPMOX.

### 2.4 Utilisateur SSH avec sudo

OpenTofu (import de disque), Ansible (`host-tuning`) et les vérifications de ce guide se connectent en SSH à l'hôte :

```bash
apt install -y sudo                                         # absent par défaut sur Proxmox
adduser --disabled-password --comment "" pad-admin          # nom libre (ssh_user de secrets/site.sops.yaml) ; connexion par clé uniquement
usermod -p '*' pad-admin                                    # aucun mot de passe, sans verrouiller le compte (sshd refuse les comptes « ! »)
mkdir -p ~pad-admin/.ssh
echo "ssh-ed25519 AAAA... pad-admin" >> ~pad-admin/.ssh/authorized_keys   # contenu de ~/.ssh/pad_admin.pub du POSTE (§1)
chown -R pad-admin: ~pad-admin/.ssh && chmod 700 ~pad-admin/.ssh && chmod 600 ~pad-admin/.ssh/authorized_keys
echo 'pad-admin ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/pad && chmod 440 /etc/sudoers.d/pad && visudo -c
```

Depuis le poste : `ssh -i ~/.ssh/pad_admin pad-admin@<hôte> sudo -n true && echo OK`.

### 2.5 Réseau de l'hôte

!!! warning "API Proxmox restreinte par pveproxy (`ALLOW_FROM` de `/etc/default/pveproxy`)"
    Si vous limitez les sources de l'interface/API Proxmox, ajoutez la zone **PROD** (`10.20.60.0/24` : CAPMOX après le pivot,
    CSI, cloud controller manager) et la zone **mgmt** (`10.20.10.0/24`), puis `systemctl restart pveproxy`. Sinon pveproxy coupe
    les connexions du cluster (`connection reset`) et les nœuds restent `uninitialized`. Contrôlé par `task check:0-prereqs`.

!!! warning "Pare-feu Proxmox activé (`/etc/pve/firewall/cluster.fw`, `enable: 1`)"
    Il met l'entrée de l'hôte en DROP par défaut. Le cluster (CAPMOX après le pivot, CSI, CCM) joint l'API Proxmox par l'IP
    mgmt de l'hôte (`host.mgmt_ip`, `10.20.10.2:8006`) depuis la zone PROD : autorisez-le, sans rien ouvrir côté Internet.
    Les flux publics de la plateforme (80, 443, NetBird) sont redirigés vers OPNsense et ne passent pas par cette règle.

    ```
    [RULES]
    IN ACCEPT -source 10.20.60.0/24 -dest 10.20.10.2 -p tcp -dport 8006 -log nolog # cluster -> API Proxmox
    IN ACCEPT -source 10.20.10.0/24 -dest 10.20.10.2 -p tcp -dport 8006 -log nolog # zone mgmt -> API Proxmox
    ```

Rien à préparer pour les ponts `vmbr2` (zones) et `vmbr1` (transit), créés en phase 1, **sauf s'ils existent déjà sur l'hôte** : la phase 0 refuse un pont `vmbrN` déjà utilisé et non créé par la plateforme (ses ponts portent le commentaire `pad:`). Choisissez alors d'autres noms : `task site:set -- zones_bridge=vmbrN transit_bridge=vmbrN` (voir 4.1). Il faut en revanche connaître votre mode WAN
(`wan.mode` du contrat) : **`routed_ip`** = une IP publique supplémentaire routée vers la VM routeur (passerelle de l'hôte, éventuellement une MAC virtuelle
exigée par l'hébergeur) ; **`nat`** = l'IP publique de l'hôte avec redirection des ports 80, 443 et UDP 3478/49152-49252 vers OPNsense par `nftables`.
Voir [Réseau et zones](architecture/reseau.md).

---

## 3. Comptes et services externes

| Besoin | À obtenir | Où ça se met |
|---|---|---|
| **Domaine** | un domaine dont vous contrôlez la zone DNS chez OVH (le fournisseur codé en dur dans le dépôt) | `domain` du contrat (`task site:set -- domain=...`) |
| **Jeton API OVH** | créé sur la page « createToken » de votre région (`ovh-eu`, `ovh-ca`, `ovh-us`) : droits `GET /domain/zone/<domaine>`, puis `GET`, `POST`, `PUT`, `DELETE` sur `/domain/zone/<domaine>/*` (les enregistrements et le rafraîchissement de la zone) | `secrets/ovh.sops.yaml` (stack `70-dns`), `secrets/edge.sops.yaml` (Traefik, ACME DNS-01), `gitops/platform/cert-manager/resources/ovh-credentials.sops.yaml` et `gitops/platform/external-dns/secret.sops.yaml` : mêmes trois valeurs (clé d'application, secret, clé consommateur) ; `endpoint` à aligner sur `acme.ovh_endpoint` |
| **IP publique** | l'IP de la plateforme (supplémentaire routée, ou celle de l'hôte en mode NAT) + passerelle en `routed_ip` | `secrets/site.sops.yaml` (`wan.*`) |
| **Webhook Discord** | un webhook de salon d'alertes (et, facultatif, un second pour le niveau `info`) | `secrets/monitoring.sops.yaml` (`discord_webhook_url`) |
| **SMTP** | serveur, expéditeur, destinataire, identifiants (alertes Alertmanager **et** e-mails de vérification d'Authentik) | `secrets/monitoring.sops.yaml` (`smtp_*`) |
| **Captcha** | un site Cloudflare Turnstile (ou hCaptcha / reCAPTCHA) autorisant `ctf.<domaine>` et `auth.<domaine>` | `secrets/authentik-tofu.sops.yaml` (`captcha_public_key`, `captcha_private_key`) |
| **GitHub** | un fork privé du dépôt ; une **clé de déploiement en lecture seule** (créée par `secrets:init`, vous ajoutez sa partie publique au fork : *Settings > Deploy keys*) ; GitHub Actions activé pour construire les images vers `ghcr.io` | `secrets/github-deploy-key.sops.yaml` |

---

## 4. Personnaliser pour son hôte

Il y a **deux familles** de valeurs propres à votre installation, qui ne vont pas au même endroit :

| Famille | Exemples | Où | Pourquoi |
|---|---|---|---|
| **Secrètes** | URL de l'API Proxmox, accès SSH, IP publique, passerelle, MAC | `secrets/site.sops.yaml` (chiffré) | jamais en clair dans Git |
| **Non secrètes mais lues par ArgoCD** | nom du nœud, noms des stockages, domaine, dépôt Git | `infra/contracts.yaml` **et** les manifests `gitops/` marqués `# contracts: …` | ArgoCD n'a que Git sous la main |

### 4.1 Valeurs non secrètes : `task site:set`

```bash
task site:set -- --show                         # valeurs courantes
task site:set -- node=pve2 datastore_vm=vmdata datastore_iso=local datastore_vm_type=zfspool
task site:set -- domain=ctf.example.org acme_email=ops@ctf.example.org
task site:set -- git_repo=https://github.com/<vous>/<fork>.git git_ssh=ssh://git@ssh.github.com:443/<vous>/<fork>.git
```

| Clé | Remplace | Dans le contrat |
|---|---|---|
| `node` | nom du nœud Proxmox (`task site:node -- <nom>` est un alias) | `host.node` |
| `datastore_vm`, `datastore_vm_type` | stockage des disques de VM/LXC et son type (`zfspool`, `lvmthin`, `lvm`, `dir`) | `host.datastore_vm`, `host.datastore_vm_type` |
| `datastore_iso` | stockage des ISO, templates, images | `host.datastore_iso` |
| `domain` | domaine public racine (et `netbird.api_url`, `acme.email` s'ils le suivaient) | `domain` |
| `acme_email` | contact Let's Encrypt | `acme.email` |
| `git_repo`, `git_ssh` | dépôt : URL HTTPS (identité des images signées, liens de runbooks) et URL SSH, celle que suit ArgoCD avec la clé de déploiement | `git.repo`, `git.ssh` |
| `dns_zone` | zone OVH qui contient `domain` quand la plateforme vit sur un sous-domaine (ex. `domain=lab.example.net dns_zone=example.net` : `ctf.lab.example.net`... ; le jeton OVH porte sur cette zone) ; vide = `domain` est la zone | `dns_zone` |
| `zones_bridge`, `transit_bridge` | noms des ponts créés en phase 1 (`vmbr2`, `vmbr1` par défaut) ; à changer si l'hôte les utilise déjà (`ip -br link`) | `host.zones_bridge`, `host.transit_bridge` |
| `wan_mode` | `routed_ip` (IP supplémentaire routée vers OPNsense) ou `nat` (IP de l'hôte, ports redirigés) | `wan.mode` |

!!! tip "Après chaque `git pull upstream main` : `task site:sync`"
    Un fichier `gitops/` nouveau ou modifié dans le dépôt public arrive avec les valeurs par défaut (domaine `CHANGEME.example.net`,
    dépôt public, nœud `pve`, stockage `local-zfs`). `task site:sync` les remplace par celles de votre contrat, dans toutes les lignes
    marquées `# contracts:` (et toutes les occurrences du domaine). Idempotent ; à commiter puis pousser avant la phase 10.


La commande est **idempotente** : elle met à jour le contrat puis chaque ligne de `gitops/` marquée `# contracts: …`, et affiche la liste des fichiers
modifiés. Ensuite : `git diff`, `bash scripts/validate-gitops.sh` (si vous avez les outils), puis **commit et push dans votre fork**.
OpenTofu lit les noms de stockage directement dans le contrat : aucune valeur n'y est codée en dur.

### 4.2 Valeurs secrètes : `secrets/site.sops.yaml`

Créé vide par `task secrets:init`, rempli avec `sops secrets/site.sops.yaml` :

| Clé | Valeur |
|---|---|
| `proxmox_url` | `https://<hôte>:8006` (sans chemin) |
| `ssh_host`, `ssh_user` | adresse par laquelle le poste joint réellement l'hôte (de préférence une IP, ex. l'IP du VPN) ; utilisateur de la section 2.4 |
| `wan.ip` | IP publique de la plateforme |
| `wan.gateway` | passerelle (obligatoire en `routed_ip`) |
| `wan.mac` | MAC dédiée de la NIC WAN du routeur, seulement si votre hébergeur l'exige |

Détail : [Valeurs de site](reference/site.md). Les autres paramètres propres à la topologie (plages d'IP, VLAN, VMID) sont dans le [contrat](reference/contrat.md) : à ne changer que si vous savez pourquoi.

---

## 5. Les secrets

```bash
task secrets:keys        # clés age (opérateur et cluster) HORS du dépôt ; renseigne les recipients de .sops.yaml
task secrets:init        # crée tous les *.sops.yaml manquants : valeurs aléatoires fortes, CHANGEME pour ce qui est externe
task secrets:pending     # liste les valeurs encore à fournir (noms de clés uniquement)
sops secrets/site.sops.yaml          # puis proxmox, ovh, edge, monitoring, authentik-tofu...
task secrets:pending
git add .sops.yaml secrets gitops && git commit -m "chore(secrets): secrets chiffrés"
```

!!! danger "Sauvegardez les deux clés privées age hors machine"
    `~/.config/sops/age/keys.txt` (opérateur) et `~/.config/pad/cluster.agekey` (cluster). Sans la première, vos secrets sont perdus ; sans la seconde, ArgoCD ne déchiffre plus rien.

À renseigner **avant de commencer** (la phase 0 les contrôle) : `site`, `proxmox` (jeton de 2.2 et `ssh.*` : la clé publique d'Ansible et vos clés admin d'OPNsense),
`ovh`, `edge`, `monitoring` (Discord, SMTP), `authentik-tofu` (captcha), `authentik.bootstrap_email`, les secrets `gitops/platform/{proxmox-csi,external-dns,cert-manager}`
et `NETBIRD_API_URL` de `gitops/apps/netbird-sync`. La clé de déploiement GitHub est générée : ajoutez sa partie publique à votre fork.

Certaines valeurs **ne peuvent pas exister avant** le déploiement ; elles restent à `CHANGEME` jusqu'à la phase indiquée, et `task secrets:check` ne sera `OK` qu'à la fin :

| Valeur | Remplie par | Phase |
|---|---|---|
| secrets des clients OIDC (NetBird, Warpgate, Grafana, front, ArgoCD) | `task secrets:oidc-sync` (automatique) | 7 |
| PAT NetBird (`netbird-tofu`, `netbird.sops` `netbird_server_api_token`, `netbird-sync`, front) | vous, depuis le dashboard NetBird | avant 11 |
| jeton Warpgate (`warpgate-tofu`) | vous, depuis l'UI Warpgate | avant 11 |
| identifiants Uptime Kuma (`uptime_kuma_username/password`) | vous, après avoir créé le compte Kuma | 12 |

Détail de la mécanique : [Secrets](SECRETS.md).

---

## 6. Les phases

Toutes les commandes se lancent depuis la racine du dépôt, dans `nix develop`, avec `TF_VAR_state_passphrase` exporté.
`tofu apply` demande une confirmation : taper `yes` à chaque stack.

### Phase 0 : prérequis (lecture seule)

- **Pourquoi** : échouer tôt, avec un message utile, plutôt qu'au milieu de la phase 6.
- **Commande** : `task phase:0-prereqs` (ou `task check:0-prereqs`).
- **Vérifie** : outils et versions (OpenTofu ≥ 1.10, `kind` du contrat, Docker), clés age, `TF_VAR_state_passphrase`, agent SSH, domaine et e-mail ACME changés, un `*.sops.yaml` par exemple,
  ponts de l'hôte (refus d'un `vmbrN` déjà utilisé et non créé par la plateforme ; sinon `task site:set -- zones_bridge=vmbrN transit_bridge=vmbrN`),
  valeurs `CHANGEME` *requises maintenant* (les valeurs d'une phase ultérieure sont signalées comme normales), SSH + `sudo`, API Proxmox, version 9.x, présence du nœud, **privilèges réels du jeton**,
  contenus des stockages (dont `import`), type du stockage, espace disque et RAM suffisants.
- **Erreurs probables** : « privilèges manquants » (revoir 2.2) ; « types de contenu manquants : import » (voir 2.1) ; « API Proxmox injoignable » (URL, pare-feu du port 8006).
- **Rejouer** : à volonté, elle ne modifie rien.

### Phase 1 : réseau de l'hôte

- **Fait** : `00-host-network` crée le pont VLAN-aware `vmbr2` (sans uplink : seul OPNsense route entre zones), l'interface `vmbr2.10` de l'hôte (`10.20.10.2`, zone mgmt), et `vmbr1` en mode `nat`.
  Puis `ansible:host` règle l'hôte : plafond de l'ARC ZFS (si ZFS), contenu `import` du stockage ISO, sysctl, DNAT de repli (mode `nat`), node-exporter, pve-exporter, Alloy. La route vers les zones et `keyctl` des LXC sont ignorés à ce stade (ni routeur ni LXC) et posés par les phases 2 et 4. (Avant la phase 4 l'inventaire généré n'existe pas : `ansible:host` utilise l'inventaire d'exemple.)
- **Commande** : `task phase:1-reseau`. Si `sudo` demande un mot de passe : `task ansible:host -- -K`.
- **Créé** : ponts `vmbr2` (et `vmbr1`), `vmbr2.10`.
- **Vérifier** : `task check:1-reseau`, ou sur l'hôte `ip -br addr show vmbr2.10` (doit porter `10.20.10.2/24`), `cat /sys/module/zfs/parameters/zfs_arc_max` (= 4294967296), `ss -ltn | grep :9100`.
- **Erreurs** : bridge « inactif » : configuration réseau en attente côté Proxmox (*Datacenter > Node > Network > Apply Configuration*, ou `ifreload -a`).
- **Rejouer** : `task phase:1-reseau`. Plan sans appliquer : `task plan:00-host-network`.

### Phase 2 : routeur et pare-feu

- **Fait** : `10-router` télécharge l'image OPNsense (somme de contrôle épinglée), construit sur **votre poste** un ISO contenant `config.xml`, le dépose sur l'hôte, crée la VM `200` (`10.20.10.1`),
  puis pilote sa console série pour déclencher l'import de la configuration. La tâche attend ensuite que la GUI réponde, pose sur l'hôte la **route vers les zones** (rôle `host-tuning`, tag `host_route` : unité `pad-route.service`, permanente et idempotente ; `task host:route`),
  et `60-opnsense-rules` installe la matrice de flux (blocage par défaut intégré d'OPNsense, journalisé, et règles « automation » par zone). Détail : [OPNsense](composants/opnsense.md), [Matrice de flux](architecture/flux.md).
- **Commande** : `task phase:2-routeur`. Pour la partie règles, l'API d'OPNsense doit être joignable : tunnel de la section 1 et `export TF_VAR_opnsense_uri=https://127.0.0.1:8443`.
- **Créé** : VM `200` (OPNsense) avec ses redirections de ports WAN (dans le `config.xml` importé : l'API NAT du provider n'existe qu'à partir d'OPNsense 26.1), règles de pare-feu (stack 60).
- **Vérifier** : `task check:2-routeur`, ou `qm list` (VM 200 `running`), `ping -c1 10.20.10.1` depuis l'hôte, `ip route get 10.20.60.5` (doit passer `via 10.20.10.1`).
- **Erreurs** : la GUI ne répond pas, OPNsense a démarré en configuration d'usine → l'import automatique a échoué. Procédure manuelle d'une minute dans `infra/opnsense/README.md`
  (console `qm terminal 200`, touche au prompt de l'importer, `cd0`), puis relancer la phase. Authentification API refusée : `api_key`/`api_secret` de `secrets/opnsense.sops.yaml` ≠ ceux du `config.xml` importé → réimporter.
- **Rejouer** : sans risque. Pour refaire la VM seule : voir [OPNsense indisponible](runbooks/opnsense-down.md).

### Phase 3 : image Talos

- **Fait** : `15-talos-image` enregistre un *schematic* chez Image Factory (extension `qemu-guest-agent`), télécharge l'image disque Talos dans le stockage `import`, et crée un **template de VM** que Cluster API clonera. Voir [Talos](composants/talos.md), [CAPMOX](composants/capmox.md).
- **Commande** : `task phase:3-image-talos`.
- **Créé** : un template (VMID du contrat `kubernetes.talos_template.vmid`).
- **Vérifier** : `task check:3-image-talos`, ou `qm list` (la ligne du template), `qm config <vmid> | grep template`.
- **Erreurs** : téléchargement refusé « content type import » → la phase 1 (rôle `host-tuning`) n'a pas posé le contenu `import` : `task ansible:host`. Le VMID du template (`kubernetes.talos_template.vmid`, clé unique du contrat, hors `vmid_range`) est celui des manifests Cluster API ; la vérification contrôle qu'il est bien un template et hors de la plage allouable par CAPMOX.
- **Rejouer** : sans risque (le fichier image n'est pas retéléchargé).

### Phase 4 : les LXC

- **Fait** : `20-services-lxc` télécharge le template Debian 13 (somme de contrôle vérifiée), crée six LXC non privilégiés avec `nesting` (puis `keyctl`, posé par `task host:lxc-features` du rôle `host-tuning`, voir 2.2), injecte la clé SSH d'Ansible, et **écrit l'inventaire** `infra/ansible/inventories/prod/hosts.generated.yml`.
- **Commande** : `task phase:4-lxc`.
- **Créé** :

  | LXC | VMID | IP | Zone |
  |---|---|---|---|
  | edge | 210 | 10.20.20.10 | DMZ |
  | netbird | 211 | 10.20.20.11 | DMZ |
  | warpgate | 230 | 10.20.30.10 | bastion |
  | authentik | 240 | 10.20.40.10 | identité |
  | monitoring | 250 | 10.20.50.10 | supervision |

- **Vérifier** : `task check:4-lxc`, ou `pct list` (5 lignes `running`), puis `ssh -J pad-admin@<hôte> root@10.20.40.10 hostname`.
- **Erreurs** : SSH par rebond impossible → la route de la phase 2 est-elle en place ? OPNsense démarré ? `keyctl` absent (la vérification le signale) → `task host:lxc-features`, voir la note de 2.2.
- **Rejouer** : sans risque. Refaire un seul LXC : `tofu -chdir=infra/tofu/stacks/20-services-lxc apply -replace='module.lxc.proxmox_virtual_environment_container.this["edge"]'` puis `task ansible:services -- --limit edge`.

### Phase 5 : DNS public

- **Fait** : `70-dns` publie quatre enregistrements `A` (`ctf`, `auth`, `vpn`, `status`) vers `wan.ip`. Les noms internes (bastion, grafana, argocd...) ne sont **jamais** publiés.
- **Commande** : `task phase:5-dns`.
- **Vérifier** : `task check:5-dns` interroge un serveur DNS **faisant autorité** pour la zone (`dns_zone`, sinon `domain`) et non le résolveur local, dont le cache négatif donnerait un faux KO juste après la création. À la main : `dig +short auth.<domaine> @<serveur DNS de la zone>` (= votre IP publique). TTL 300 s : patientez après un premier changement.
- **Erreurs** : `This call has not been granted` → droits du jeton OVH (section 3) ; mauvais `endpoint` dans `secrets/ovh.sops.yaml`.
- **Rejouer** : sans risque.

### Phase 6 : services, passe 1

- **Fait** : Ansible installe, dans chaque LXC, le durcissement de base, Docker, Alloy puis le service : **monitoring** (VictoriaMetrics, Loki, Tempo, Grafana, Alertmanager, Uptime Kuma), **Authentik**, **edge** (Traefik + CrowdSec, certificats Let's Encrypt par DNS-01 OVH).
  Pourquoi en deux passes : les secrets des clients OIDC de NetBird et Warpgate sont *générés* à la phase 7 et exigent Authentik. Voir [Ansible](composants/ansible.md), [Traefik edge](composants/traefik-edge.md), [Authentik](composants/authentik.md).
- **Commande** : `task phase:6-services-1`.
- **Vérifier** : `task check:6-services-1`, ou `curl -I https://auth.<domaine>/-/health/live/` (204, certificat valide), `ssh -J … root@10.20.50.10 docker ps`, `curl http://10.20.50.10:8428/health` depuis l'hôte.
- **Erreurs** : certificat non valide → journaux Traefik (`docker logs` dans le LXC edge) : jeton OVH sans les droits `/domain/zone/<domaine>/*`. Conteneur Authentik en boucle → `docker logs`. Le compte `akadmin` est créé avec `bootstrap_password` (`sops -d --extract '["bootstrap_password"]' secrets/authentik.sops.yaml`).
- **Rejouer** : sans risque (rôles idempotents). Un seul service : `task ansible:services -- --tags edge --limit edge`.

### Phase 7 : identité

- **Fait** : `30-authentik` crée groupes (`ctf-players`, `ctf-managers`, `ctf-admins`, `infra-admins`), flows d'inscription (captcha, e-mail) et de connexion staff (MFA), et un client OIDC par application. Les secrets générés sont ensuite **recopiés** dans les sops de NetBird, Warpgate, Grafana, du front et d'ArgoCD (`task secrets:oidc-sync`, sans jamais les afficher).
- **Commande** : `task phase:7-identite`, **depuis une machine autorisée par l'edge** (voir la table de la section 1).
- **À faire ensuite** : commiter les sops modifiés.

  ```bash
  git add secrets gitops && git commit -m "chore(secrets): secrets OIDC"      # le push a lieu avant la phase 10
  ```
- **Action manuelle (MFA)** : créez votre utilisateur (console d'Authentik, accès depuis le bastion/mgmt), ajoutez-le à `infra-admins`, et à sa première connexion enrôlez **deux** facteurs. [Détail](operations/actions-post-deploiement.md) (action 3), [Identité](operations/securite-identite.md).
- **Vérifier** : `task check:7-identite`, ou `curl https://auth.<domaine>/application/o/pad-frontend/.well-known/openid-configuration`.
- **Erreurs** : `403`/blocage sur `/api/v3/admin` → votre IP n'est pas autorisée par l'edge ; clés captcha vides → `secrets/authentik-tofu.sops.yaml`.
- **Rejouer** : sans risque, `oidc-sync` est idempotent. Plan : `task plan:30-authentik`.

### Phase 8 : services, passe 2

- **Fait** : Ansible déploie **Warpgate** (bastion SSH/HTTPS avec SSO), **NetBird** (VPN : serveur combiné management/signal/relay + dashboard) et rejoue le monitoring (Grafana en SSO). Voir [Warpgate](composants/warpgate.md), [NetBird](composants/netbird.md).
- **Commande** : `task phase:8-services-2`.
- **Vérifier** : `task check:8-services-2`, ou `curl -I https://vpn.<domaine>`, et **depuis le LXC netbird** : `curl -sS https://auth.<domaine>/application/o/pad-netbird/.well-known/openid-configuration` (rétro-canal OIDC).
- **Erreurs** : le LXC netbird n'atteint pas `https://auth.<domaine>` : les zones internes doivent résoudre les noms publics (`public_hostnames` du contrat) vers l'IP **interne** de l'edge, pas l'IP publique (pas de réflexion NAT). C'est posé par la stack `60-opnsense-rules` (overrides Unbound, `task check:2-routeur` les contrôle) et le flux I2 (toutes zones vers l'edge en 443). Vérifier : `dig +short auth.<domaine> @10.20.20.1` depuis un LXC doit rendre `10.20.20.10`.
- **Rejouer** : sans risque.
- **Actions manuelles à faire maintenant (avant la phase 11)** :
    1. Ouvrir `https://vpn.<domaine>` et se connecter avec le **compte local propriétaire** (formulaire e-mail / mot de passe, pas le SSO : le connecteur Authentik n'est ajouté qu'en phase 11, avec le PAT ci-dessous) : `admin@<domaine>`, mot de passe `netbird_server_owner_password` de `secrets/netbird.sops.yaml` (`sops -d --extract '["netbird_server_owner_password"]' secrets/netbird.sops.yaml`). **Supprimer la policy « Default »** (*Access Control > Policies*) : sinon tout pair joint tout pair (action 4).
    2. Créer un **PAT administrateur** NetBird (*Settings > Personal Access Tokens*), le placer dans `secrets/netbird-tofu.sops.yaml` (`api_token`) **et** `secrets/netbird.sops.yaml` (`netbird_server_api_token`).
    3. Console admin d'Authentik (pour créer son compte staff, dans `infra-admins`) : non publiée, ouvrir `https://<IP du LXC authentik>/if/admin/` via la route VPN (compte `akadmin`, `bootstrap_password` de `secrets/authentik.sops.yaml`) ; un utilisateur créé là n'a pas de mot de passe : *Set password*.
    4. Dans l'UI de Warpgate, **par son nom** et pas par son IP (Warpgate lie la session à `external_host` : par IP, la connexion réussit puis le cookie est rejeté, retour au formulaire sans erreur). Le nom est interne : `echo "10.20.30.10 bastion.<domaine>" | sudo tee -a /etc/hosts`, puis `https://bastion.<domaine>:8888` (compte `admin`, mot de passe `warpgate_admin_password` de `secrets/warpgate.sops.yaml`), créer un jeton d'API (*Config > API tokens*) → `secrets/warpgate-tofu.sops.yaml`.
    5. Après la phase 11 : PAT des utilisateurs de service `netbird-sync` et `pad-frontend-readonly` (voir phase 11).

### Phase 9 : le cluster Kubernetes

- **Fait** (`bootstrap/scripts/cluster.sh`, reprenable à chaque étape) : un cluster `kind` éphémère sur votre poste reçoit Cluster API (`clusterctl init`), applique `gitops/clusters/prod`, CAPMOX clone le template et démarre les VM Talos, les `kubeconfig`/`talosconfig` sont extraits dans `.state/`, les CRD Prometheus (`ServiceMonitor`, requises par les values des charts suivants), cert-manager, Cilium puis le cloud controller manager Proxmox sont installés (le CCM retire des nœuds le taint `node.cloudprovider.kubernetes.io/uninitialized` et pose le providerID attendu par CAPMOX ; sa configuration est le Secret du CSI, déchiffré par sops et appliqué sans passer par le disque), puis `clusterctl move` transfère la gestion au cluster lui-même (**pivot**) et `kind` est supprimé. Voir [Bootstrap](architecture/bootstrap.md), [Cluster API](composants/cluster-api.md), [kind](composants/kind.md).
- **Commande** : `task phase:9-cluster` (30 à 45 min ; docker doit tourner, la route vers `10.20.60.0/24` doit exister ; `gitops/platform/proxmox-csi/secret.sops.yaml` doit être complet, avec `features.provider: capmox`, voir 2.3).
- **Créé** : VM Talos dans la plage VMID `300-399` : 1 control plane (`10.20.60.10-14`), 2 workers `platform` (`10.20.60.20-39`) ; VIP de l'API `10.20.60.5`. **Pas de worker `challenges`** à cette phase : la zone CHALLENGES n'a aucun egress Internet et ses nœuds tirent toutes leurs images (kubelet compris) du cache pull-through de Zot, qui n'existe qu'après la phase 10. Le pool (annoté `pad.io/bootstrap: gitops`) est créé par ArgoCD (Application `cluster-prod`) ; créé avant, son worker ne rejoindrait jamais le cluster et `clusterctl move` refuserait de pivoter (toute Machine doit avoir un `nodeRef`).
- **Vérifier** :

  ```bash
  export KUBECONFIG=$PWD/.state/kubeconfig TALOSCONFIG=$PWD/.state/talosconfig
  qm list                                             # sur l'hôte : les VM pad-prod-*
  kubectl get nodes -o wide                           # tous Ready
  kubectl get nodes -o custom-columns=NOM:.metadata.name,PROVIDERID:.spec.providerID,TAINTS:.spec.taints[*].key
                                                      # providerID proxmox://<uuid>, plus de taint uninitialized
  kubectl -n pad-cluster get cluster,machines         # Cluster Provisioned, Machines Running
  talosctl -e 10.20.60.5 -n 10.20.60.5 health
  kind get clusters                                   # doit être vide : kind est supprimé après le pivot
  ```
- **Erreurs** : bloqué sur `Provisioned` → `kubectl --kubeconfig .state/kind.kubeconfig -n pad-cluster describe machine` (API Proxmox joignable depuis le conteneur kind ? jeton CAPMOX ? template au bon VMID ?). Nœuds `NotReady` → Cilium (`kubectl -n kube-system get pods`). Pods `Pending` (cert-manager) sur des nœuds `Ready` → taint `uninitialized`, voir le dépannage (§9). Pivot en échec : kind est **conservé**, relancer la phase.
- **Rejouer** : sans risque, les étapes déjà faites sont sautées.

### Entre les phases 9 et 10 : publier et épingler les images

Les manifests référencent les images de la plateforme (CTFd, front, netbird-sync) par `tag@sha256:…` avec une empreinte de remplacement nulle : tant qu'elle n'est pas remplacée, les pods ne démarrent pas (volontaire).

1. Poussez sur la branche `main` de votre fork : le workflow `images.yml` construit, scanne, pousse et signe `ghcr.io/<vous>/pad-*`.
2. **Rendez les packages `pad-*` publics** (GitHub > votre profil > *Packages* > chaque package > *Package settings* > *Change visibility* > *Public*) : GitHub les crée **privés** par défaut et le cluster n'a pas de secret de pull ; sans cela, `ImagePullBackOff`.
3. Épinglez les empreintes, vérifiez, commitez et poussez :

   ```bash
   task apps:pin-digests -- <sha court du commit publié>   # défaut : HEAD ; aucun appel à la CI, aucune PR
   git diff                                                # chaque référence est tag@sha256:<empreinte réelle>
   git add gitops challenges && git commit -m "chore(images): empreintes épinglées" && git push
   ```

Détail et vérification des signatures : [Images signées](operations/images-signees.md).

### Phase 10 : ArgoCD

- **Fait** : vérifie que tout est commité **et poussé** et que la clé de déploiement lit le dépôt (`git ls-remote` sur `git.ssh` avec cette clé : échoue tant que sa partie publique n'est pas dans *Settings > Deploy keys*), applique le namespace `argocd` et ses NetworkPolicy (egress Git/Helm du repo-server), installe ArgoCD (Helm, version et values de l'Application), crée le Secret `sops-age` (clé du **cluster**, jamais celle de l'opérateur) et le Secret du dépôt (clé de déploiement), applique l'Application `root` (app-of-apps). ArgoCD déroule ensuite tout par vagues : Cilium, Proxmox CCM, cert-manager, Kyverno, Proxmox CSI, Traefik, Garage, Zot, MariaDB, Valkey, KEDA, puis CTFd, le front, chall-manager, netbird-sync. Voir [ArgoCD](composants/argocd.md).
- **Worker `challenges`** : l'Application `cluster-prod` (vague 5) crée le pool `challenges` ; CAPMOX démarre le worker en zone CHALLENGES, qui tire kubelet, Cilium, CSI, Alloy et node-exporter par `registry.pad.internal/mirror/<registre>/` ([Zot, miroir pull-through](composants/zot.md#miroir-pull-through-zone-challenges)). Il rejoint le cluster une fois Zot `Healthy`, soit 10 à 15 minutes après le début de la phase ; `task check:10-gitops` le contrôle.
- **Commande** : `task phase:10-gitops`.
- **Vérifier** :

  ```bash
  kubectl -n argocd get applications                  # Synced/Healthy au fil de l'eau (compter 15 à 30 min)
  argocd login --core && argocd app list              # même chose avec la CLI
  kubectl get pods -A | grep -v Running               # ce qui n'est pas encore prêt
  kubectl get storageclass                            # pad-zfs, fournie par le CSI Proxmox
  kubectl get nodes -l pad.io/pool=challenges -o wide # worker challenges Ready (après Zot)
  ```
- **Erreurs** : `ksops`/`no identity matched` → Secret `sops-age` absent ou clé du cluster pas recipient (`task secrets:update-keys`, commit, push, `task bootstrap:gitops`). `ImagePullBackOff` → packages privés ou empreintes `000…` (section précédente). PVC `Pending` → secret du CSI (`token_secret`) ou privilèges de `csi@pve`.
- **Rejouer** : sans risque (`helm upgrade --install`, `kubectl apply`). Les runbooks : [ArgoCD](runbooks/argocd.md), [charges Kubernetes](runbooks/kubernetes-workloads.md).

### Phase 11 : accès staff et joueurs

- **Fait** : rejoue NetBird (le PAT du *owner* active le connecteur OIDC Authentik et les groupes JWT), `40-netbird` (groupes, réseaux `pad-instances` et `pad-bastion`, policy `staff-vers-bastion`, clés d'enrôlement des routing peers, utilisateurs de service), recopie ces clés dans `secrets/netbird-agent.sops.yaml` (`task netbird:sync-keys`), enrôle les **deux routing peers** (`task netbird:agents` : `/dev/net/tun` ajouté depuis l'hôte aux LXC `nbrouter` et `warpgate`, agent NetBird épinglé, `netbird up` une seule fois) et `50-warpgate` (rôles et cibles : LXC, OPNsense, Proxmox). Elle **exige** les jetons de la phase 8 ; le contrôle préalable le dit si l'un manque. Voir [NetBird](composants/netbird.md), [netbird-sync](composants/netbird-sync.md).
- **Commande** : `task phase:11-acces`. Si le provider échoue à joindre Warpgate par son nom public interne : `-var insecure_skip_verify=true` ou `-var warpgate_api_url=https://10.20.30.10:8888` via `task tofu:apply-stack STACK=50-warpgate -- -var …`.
- **Actions manuelles ensuite** :
    1. Dashboard NetBird > *Team > Service Users* : créer un PAT pour `netbird-sync` → `gitops/apps/netbird-sync/secret.sops.yaml` (`NETBIRD_API_TOKEN`), et pour `pad-frontend-readonly` (rôle `auditor`) → `gitops/apps/frontend/secret.sops.yaml` (`NETBIRD_API_TOKEN`). Commit + push (ArgoCD redéploie). Ne jamais réutiliser le PAT de l'un pour l'autre.
    2. **Routing peers** : rien à faire à la main, la phase s'en charge (voir « Ce que fait la phase » ci-dessous) ; seul le contrôle `task check:11-acces` est à lire.
    3. Les règles OPNsense des routing peers sont dans `60-opnsense-rules` (règles `N1` à `N6` : HTTPS vers le management/relay, STUN, WireGuard direct, apt et NTP de `nbrouter`) : rien à ajouter.
    4. Zot : identifiants de pull sur les nœuds du pool `challenges` (action 8), puis publication dans Zot du scénario chall-manager et des images de challenge, depuis un poste qui joint `registry.pad.internal` (NetBird staff ou bastion) :

        ```bash
        oras login registry.pad.internal -u pad-ci        # mot de passe : sops -d secrets/credentials.sops.yaml
        crane auth login registry.pad.internal -u pad-ci -p '<mot de passe>'
        task apps:zot:publish -- <sha court publié sur ghcr>   # défaut : HEAD
        ```

        Le scénario (artefact OCI Pulumi, pas une image Docker) est compilé et poussé avec `oras` ; les images de challenge sont copiées de ghcr vers `registry.pad.internal/ctf/` à l'identique (`crane copy`), donc l'empreinte épinglée dans `challenge.yml` reste valable. Cosign et `enforce` (action 9) plus tard.
- **Ce que fait la phase pour les routing peers** : un routing peer par zone, `nbrouter` (LXC dédié `10.20.70.10`, zone CHALLENGES, network `pad-instances`) et l'agent sur `warpgate` (zone BASTION, network `pad-bastion`), tous deux en masquerade. Setup keys réutilisables (5 usages, 30 jours) : rejouer la phase ne réenregistre rien. Clé expirée ou épuisée après une reconstruction : `task netbird:rotate-keys`.
- **Vérifier** : `task check:11-acces` (pairs `pad-routers-*` connectés, routeur actif sur chaque network, `netbird status` sur les LXC), ou dashboard NetBird (groupes `ctf-players`, `infra-admins`, networks), `kubectl -n netbird-sync logs deploy/netbird-sync` (pas de 401/403, pas de « refus de démarrer »).
- **Rejouer** : sans risque. Plans : `task plan:40-netbird`, `task plan:50-warpgate`.

### Phase 12 : vérification

- **Commande** : `task phase:12-verify`, depuis un poste **connecté à NetBird** pour les contrôles internes. Joue `scripts/verify.sh` : HTTPS public, découverte OIDC, `/api/health` du front, nœuds Ready, ArgoCD Synced/Healthy, Cluster Provisioned, isolation de la zone challenges, VictoriaMetrics. Puis rappelle les actions manuelles restantes.
- **Ensuite** : `task backup` (premier point de restauration), puis la checklist de la section 8.

---

## 7. Détruire, reconstruire, repartir de zéro

Toutes les destructions passent par `scripts/confirm-destroy.sh` : taper `destroy` (ou `PAD_CONFIRM_DESTROY=destroy` en non interactif ; `--yes` seul ne suffit pas). **Faites `task backup` avant** : les données de CTFd et de Garage vivent dans le cluster.

### 7.1 Détruire le cluster seul

| Cas | Commande | Ce qui se passe |
|---|---|---|
| Cluster sain | `task cluster:destroy` | gèle l'application-controller d'ArgoCD (il recréerait les objets), crée un `kind` frais, **pivot inverse** (`clusterctl move` pad-prod → kind), supprime l'objet `Cluster` : CAPMOX détruit les VM Talos. Efface `.state/kubeconfig` et `talosconfig`. |
| Cluster cassé (API morte, CAPI HS, pivot impossible) | `task cluster:destroy-force` | supprime directement par l'API Proxmox les VM étiquetées `pad-prod` de la plage `300-399` (hors template), sans Cluster API |

Conservés : routeur, LXC, DNS, accès NetBird/Warpgate, secrets. **Les volumes persistants du CSI (`vm-…-pvc-…`) ne sont pas supprimés** avec les VM : `task check:cluster-detruit` les liste ; les supprimer sur l'hôte avec `pvesm free <volid>` si vous n'en voulez plus.
Reconstruire : `task cluster:rebuild` (= destroy + phases 9 et 10), puis `task restore` pour les données ([sauvegarde et restauration](runbooks/backup-restore.md)).

### 7.2 Tout détruire (sauf l'hôte)

`task destroy`, dans l'ordre inverse du déploiement :

1. `70-dns` (ressource externe : un échec bloque), puis `50-warpgate`, `40-netbird`, `30-authentik` ;
2. le cluster (pivot inverse, repli API Proxmox) ;
3. `20-services-lxc`, `60-opnsense-rules`, `15-talos-image`, `10-router`, `00-host-network`.

Un state absent n'est **jamais** bloquant (« rien à détruire »). Pour 30, 40, 50 et 60, qui ne font que configurer un service détruit juste après, un échec d'API (service déjà parti, jeton périmé)
met le state de côté dans `.state/tofu/orphelins/` et continue. Ensuite `task check:tout-detruit` contrôle qu'il ne reste rien. Reconstruire : `task rebuild` (destroy puis up, chronométré).

!!! warning "Après un rebuild complet, les jetons créés à la main sont périmés"
    NetBird et Warpgate repartent de zéro : refaire les actions de la phase 8 (PAT NetBird, jeton Warpgate, suppression de la policy « Default »), et remettre `CHANGEME` dans les anciens
    jetons pour que la vérification préalable les réclame.

### 7.3 Ce qui survit à une destruction

| Élément | Où | Rôle |
|---|---|---|
| states OpenTofu chiffrés | `.state/tofu/` | utiles tant que quelque chose existe ; **inutiles et trompeurs** après une destruction complète |
| `kubeconfig`, `talosconfig` | `.state/` | supprimés par les destructions du cluster |
| marqueurs de phase | `.state/phases/` | alimentent `task status` ; effacés par les destructions |
| sauvegardes | `.state/backups/` | à copier hors machine |
| clés age | `~/.config/sops/age/keys.txt`, `~/.config/pad/cluster.agekey` | **indispensables** pour tout rebâtir |
| secrets chiffrés | `secrets/*.sops.yaml`, `gitops/**/*.sops.yaml` (Git) | rejoués tels quels (sauf jetons NetBird/Warpgate périmés) |
| phrase secrète des states | `~/.config/pad/state.pass` | nécessaire pour lire les states restants |
| l'hôte Proxmox | | stockages, ponts de base, jeton API, utilisateur SSH |

### 7.4 Repartir VRAIMENT de zéro

```bash
task destroy                 # ou cluster:destroy-force + suppression manuelle si quelque chose bloque
task check:tout-detruit      # plus rien dans Proxmox ?
task state:purge             # efface .state/tofu, kubeconfig, marqueurs, inventaire généré (garde clés, sops, sauvegardes)
task phase:0-prereqs         # puis les phases, ou task up
```

`task state:purge -- --force` abandonne des states non vides (les ressources resteront sur l'hôte : à supprimer à la main avec `qm destroy`, `pct destroy`, `pvesm free`) ; `-- --backups` efface aussi les sauvegardes.
Si vous avez **perdu** la phrase secrète des states : supprimez à la main ce qui reste sur l'hôte (invités `200`, `210-250`, `299`/template, `300-399`, ponts `vmbr1/vmbr2`), puis `task state:purge -- --force`.

---

## 8. Checklist finale de validation

Avant d'ouvrir l'événement aux joueurs :

- [ ] `task status -- --live` : toutes les phases `faite`, aucune `DÉGRADÉE`.
- [ ] **SSO** : inscription d'un compte joueur de test (captcha, e-mail de vérification reçu), connexion au front `https://ctf.<domaine>` ; un compte `infra-admins` voit ArgoCD, Warpgate, Grafana, un compte joueur n'en voit aucun ; MFA exigée pour le staff.
- [ ] **NetBird** : un poste de joueur de test s'enrôle (`https://vpn.<domaine>`), la policy « Default » est supprimée, `netbird_sync_open_policies` = 0.
- [ ] **Instance joignable uniquement par le VPN** : l'équipe lance une instance depuis le front ; elle répond **avec** NetBird (`nc -zv 10.20.70.1xx <port>`), et **pas sans** (depuis Internet, par exemple un téléphone en 4G).
- [ ] **Flags et scoreboard** : un challenge statique et un challenge instancié se résolvent, le scoreboard se met à jour en direct.
- [ ] **Alertes** : arrêter un exporter (`systemctl stop prometheus-node-exporter` sur un LXC) → l'alerte arrive sur Discord et par e-mail ; le `Watchdog` est vert ([Watchdog](runbooks/watchdog.md)).
- [ ] **Sauvegarde** : `task backup`, puis un test de restauration sur un environnement jetable ([procédure](runbooks/backup-restore.md)).
- [ ] Actions manuelles terminées ([liste](operations/actions-post-deploiement.md)) : MFA, policy Default, PAT, Zot, cosign, protection de la branche `main`.
- [ ] Clés age et phrase des states sauvegardées **hors machine**.

---

## 9. Dépannage transversal

| Symptôme | Piste |
|---|---|
| SYN reçu par un LXC sans réponse, `InCsumErrors` qui augmente (`grep -A1 ^Tcp: /proc/net/snmp` dans le LXC), `tcpdump -vv` : `incorrect cksum` | déchargements matériels actifs sur les NIC virtio d'OPNsense : le `config.xml` de bootstrap les désactive ; sur un routeur déjà installé, *Interfaces > Settings* (cocher les trois « Disable hardware ... offload ») puis redémarrer |
| Ansible : hôtes `UNREACHABLE` au hasard (`Connection timed out during banner exchange`, `Data could not be sent`) alors que les LXC tournent | OpenSSH >= 9.8 sur l'hôte (`PerSourcePenalties`) refuse temporairement le poste qui ouvre trop de sessions. Le rebond est multiplexé (une seule session sur l'hôte, `~/.ansible/cp/pad-jump-*`) : vérifier que le dépôt est à jour ; en dernier recours, sur l'hôte, `PerSourcePenaltyExemptList` avec la plage du VPN |
| Worker `challenges` créé mais absent de `kubectl get nodes` ; `talosctl -n <IP> service kubelet` : `Waiting for time sync` | pas d'NTP Internet en zone CHALLENGES : règle `m10-chall-ntp` (stack 60) et `machine.time.servers` du modèle Talos `pad-prod-challenges-v2` ; sur un nœud déjà créé : `talosctl -n <IP> patch mc -p '[{"op":"add","path":"/machine/time","value":{"servers":["10.20.70.1"]}}]'` |
| Nœud `challenges` absent ou `NotReady`, pods `ImagePullBackOff` / `ErrImagePull` sur ce nœud (Cilium, CSI, Alloy, node-exporter), `talosctl -n <IP> logs kubelet` ou `talosctl -n <IP> dmesg` : échec de pull de `ghcr.io/siderolabs/kubelet` | la zone CHALLENGES n'a **aucun egress Internet** : toutes ses images passent par le miroir Zot (`registry.pad.internal/mirror/<registre>/`), disponible seulement après la phase 10. Vérifier dans l'ordre : Application `zot` `Synced/Healthy` ; `dig @10.20.70.1 registry.pad.internal` doit répondre `10.20.60.200` (override Unbound, stack 60) ; règle `m10-chall-registry` (CHALLENGES vers ingress 443) appliquée (`task tofu:apply-stack STACK=60-opnsense-rules`) ; `crane digest --insecure registry.pad.internal/mirror/ghcr.io/siderolabs/kubelet:v1.34.1` depuis un poste staff ; journaux `kubectl -n registry logs sts/zot \| grep -i sync` (`filtered out by content` : dépôt absent de la liste blanche `content` de `gitops/platform/zot/values.yaml`). Le nœud réessaie seul, rien à relancer. [Zot, miroir pull-through](composants/zot.md#miroir-pull-through-zone-challenges) |
| Nœuds `uninitialized` ; journaux du CCM ou du CSI : `read: connection reset` vers `10.20.10.2:8006` | pveproxy refuse la source (`ALLOW_FROM` de `/etc/default/pveproxy`) : y ajouter `10.20.60.0/24,10.20.10.0/24`, puis `systemctl restart pveproxy` (§2.5) |
| Application `root` en `Unknown` : `authentication required: Repository not found` ou `context deadline exceeded` | ArgoCD lit le dépôt avec la clé de déploiement, donc en SSH (`git.ssh`), et les zones n'ont d'egress qu'en 80/443 : `git_ssh` doit être `ssh://git@ssh.github.com:443/<vous>/<fork>.git` (`task site:set`), puis commit, push et `task phase:10-gitops` |
| Applications en `Unknown`, repo-server : `failed to list refs: dial tcp …:443: connect: connection timed out` | Egress du namespace `argocd` bloqué par sa `default-deny-baseline` : la CiliumNetworkPolicy `argocd-repo-server-egress` (même fichier) doit exister ; `task phase:10-gitops` l'applique avant ArgoCD |
| Nœud injoignable après un redémarrage (`qm config` : `ide0: none`, agent invité arrêté) | Talos v1.11.3 perd son IP quand CAPMOX a retiré l'ISO cloud-init (siderolabs/talos#12097) : Talos ≥ v1.11.4 obligatoire (contrat : v1.11.6). Récupération : [Talos](composants/talos.md#redemarrage-des-nuds-et-configuration-reseau) |
| Phase 10 : Applications bloquées en `OutOfSync` / `Running`, `argocd-application-controller-0` en `OOMKilled` | Mémoire du contrôleur ArgoCD insuffisante (cache de toutes les ressources du cluster) : `controller.resources` de `gitops/platform/argocd/values.yaml` (limite 1536Mi), puis `task phase:10-gitops` (le Helm du bootstrap applique ces values) |
| PVC en `Pending`, pods « didn't find available persistent volumes to bind » | La region des nœuds (posée par le CCM depuis `gitops/platform/proxmox-csi/secret.sops.yaml`) diffère de celle de la StorageClass `pad-zfs` (`kubectl get nodes -L topology.kubernetes.io/region`). Toutes deux suivent `host.node` : `task site:sync` réaligne aussi les secrets chiffrés ; les nœuds déjà initialisés gardent l'ancien label (le CCM ne le pose qu'à l'initialisation) : les recréer, ou `kubectl label node <n> topology.kubernetes.io/region=<host.node> --overwrite` |
| Phase 10 : API du cluster intermittente (`TLS handshake timeout`, `dial tcp 10.20.60.5:6443: operation timed out`) dès qu'ArgoCD déploie la plateforme | Mémoire du control plane saturée (`kubectl top nodes` > 100 %) : `kube-apiserver` grossit avec les CRD installées. `kubernetes.control_plane.memory_mb` est à 4096 ; pour changer la taille, renommer le `ProxmoxMachineTemplate` (`pad-prod-cp-vN`, immuable) : CACPPT remplace le nœud |
| `tofu` : `Error acquiring the state` ou illisible | `TF_VAR_state_passphrase` différent de celui du state ; ne jamais en changer sans détruire |
| `tofu` : authentification Proxmox | jeton (2.2), `proxmox_url`, `proxmox.insecure` ; `task check:0-prereqs` |
| Depuis le poste, aucune zone ne répond hors mgmt (SYN sans SYN-ACK) alors que l'hôte les joint | table `inet pad_raw` absente de l'hôte (`sudo nft list table inet pad_raw`) : `task ansible:host -- --tags host_bridge_notrack` |
| Ansible : hôte injoignable | clé dans l'agent ; `ssh_host`/`ssh_user` ; route de l'hôte vers les zones (`task host:route`, rôle `host-tuning`) |
| `tofu` (phase 2) : `unable to authenticate user ... over SSH to "<IP>:22" ... i/o timeout` | le provider se connecte à `ssh_host` (et non à l'adresse annoncée par l'API Proxmox) : vérifier `ssh_host` dans `secrets/site.sops.yaml` (adresse joignable depuis le poste, ex. IP VPN) et que le dépôt est à jour |
| Phase 4 : LXC `running` mais SSH injoignable (Ansible : « SSH injoignable ») | vérifier que la règle **M0** est appliquée : `task tofu:apply-stack STACK=60-opnsense-rules` (le rebond passe par l'IP mgmt de l'hôte). Voir le journal pf sur OPNsense : `tcpdump -n -e -i pflog0 host <IP du LXC>` |
| Phase 4 (LXC) : `unable to create CT ... zfs error: cannot mount '...subvol-...': no mountpoint set` | le dataset ZFS du stockage des VM a `mountpoint=none` : `zfs set mountpoint=/<dataset> <dataset>` sur l'hôte (2.1), puis relancer la phase |
| Phase 5 OK, mais le navigateur ou le poste ne résout pas encore le nom | cache négatif du résolveur local : attendre le TTL négatif de la zone ou vider le cache DNS du poste |
| `kubectl` : `connection refused` / délai | route de votre poste vers `10.20.60.0/24` ; VIP `10.20.60.5` ; VM allumées |
| Certificat « TRAEFIK DEFAULT CERT » servi par l'edge | les routeurs n'ont pas de `certResolver` (un `tls: {}` écrase la configuration de l'entrypoint ; ils doivent porter `tls: *pad_tls`) : vérifier `docker logs pad-edge-traefik-1 \| grep lego` |
| `ovh: could not find zone for domain` / timeouts DNS (1.1.1.1, 9.9.9.9) depuis l'edge | règle `i5-egress-dns` (DNS sortant 53 TCP/UDP, nécessaire à ACME DNS-01) non appliquée : `task tofu:apply-stack STACK=60-opnsense-rules` |
| Phase 9 : workers jamais démarrés, `ProxmoxMachine` en `VMProvisionFailed: unable to render network-config: route already exists for destination/metric in routing table`, deux `IPAddressClaim` par worker | manifeste antérieur au correctif « zones CAPMOX » : CAPMOX force `defaultIPv4: true` sur `net0` et ajoute une IP du control plane à celle du pool. Mettre le dépôt à jour (`zoneConfig` + `network.zone`), supprimer les `MachineDeployment`, les `ProxmoxMachineTemplate` des workers (immuables) et les anciens `InClusterIPPool` `pad-prod-platform`/`pad-prod-challenges`, puis relancer la phase : [CAPMOX, pièges connus](composants/capmox.md#pieges-connus) |
| Phase 9 : nœuds `Ready` mais avec le taint `node.cloudprovider.kubernetes.io/uninitialized`, pods `Pending` (cert-manager, Hubble, metrics-server ; « cert-manager disponible » expire), Machines CAPI bloquées en `Provisioned`, `spec.providerID` vide | le cloud controller manager Proxmox n'a pas initialisé les nœuds (kubelets en `cloud-provider: external`). `kubectl -n csi-proxmox get pods,secret` puis `kubectl -n csi-proxmox logs deploy/proxmox-cloud-controller-manager` : CCM absent (dépôt antérieur : mettre à jour et relancer la phase, l'étape CNI le réinstalle), `401`/`403` (jeton ou rôle `CSI` : `VM.Audit` et `Sys.Audit`, 2.3), délai vers `10.20.10.2:8006` (règle M9, pare-feu de l'hôte, 2.5), `instance not found` (`features.provider` doit valoir `capmox`). [Proxmox CCM](composants/proxmox-ccm.md) |
| Une phase échoue à mi-chemin | la corriger puis relancer **la même phase** ; elle reprend là où elle s'est arrêtée |
| Savoir où l'on en est | `task status` (rapide) ou `task status -- --live` (contacte l'hôte) |

Référence de toutes les tâches : [Tâches `task`](reference/taches.md). Incidents en production : [Incident générique](runbooks/incident.md).
