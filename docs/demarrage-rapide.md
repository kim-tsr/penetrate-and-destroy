# Démarrage rapide

Ce résumé déploie la plateforme complète sur un hyperviseur Proxmox VE neuf. Compter une à deux heures à la
première exécution, hors temps de préparation des prérequis.

## Prérequis

### Matériel

Budget de ressources cible de la plateforme (voir [Scaling](architecture/scaling.md)) :

| Ressource | Cible | Remarque |
|---|---|---|
| CPU | 8 vCPU | surcommit accepté |
| RAM | environ 26 Go | le total alloué va d'environ 17 Go (minimum) à 22 Go (maximum) |
| Disque | stockage ZFS | l'ARC ZFS est limité à 4 Go |
| Réseau | une IP publique | idéalement une IP supplémentaire routée vers la VM routeur, sinon le mode `nat` |

### Comptes et accès

- Un hôte **Proxmox VE 9.x**, vierge ou sans conflit de VMID ni de bridge avec le contrat, et un **token API**
  Proxmox (privilèges VM, LXC, stockage et réseau).
- Un accès SSH à l'hôte, root ou sudo, pour le rôle `host-tuning` (ARC ZFS, nftables, sysctl).
- Un **domaine** et un token API DNS (OVH par défaut) pour cert-manager et external-dns.
- Un webhook Discord et un SMTP pour les notifications d'alerte.
- Un dépôt Git joignable par le cluster (ArgoCD) et, si le dépôt est privé, une clé de déploiement.

### Poste opérateur

Le shell de développement est fourni par Nix et épingle tous les outils :

```bash
nix develop
```

Il apporte `task`, `tofu`, `ansible`, `kubectl`, `helm`, `clusterctl`, `kind`, `sops`, `age`, `yq`, `k6` et le reste.
Un démon Docker local est nécessaire pour le cluster `kind` éphémère du bootstrap.

!!! tip "Guide complet"
    Pour déployer phase par phase, en vérifiant chaque étape (et savoir détruire et repartir de zéro), suivre le [Guide de déploiement](guide-deploiement.md). Cette page n'en est que le résumé.

## 1. Valeurs de site

Les valeurs propres à votre hôte (URL de l'API Proxmox, accès SSH, IP publique, passerelle, MAC) sont des entrées
que vous fournissez dans `secrets/site.sops.yaml`, chiffré comme les autres secrets (étape suivante) :

```bash
sops secrets/site.sops.yaml     # après task secrets:init
```

Le nœud Proxmox s'appelle `pve` dans le contrat ; pour un autre nom : `task site:node -- <nom>`.
Détails dans [Valeurs de site](reference/site.md).

## 2. Secrets

Les secrets sont commités **chiffrés** (SOPS + age). Procédure complète : [Secrets](SECRETS.md).

```bash
task secrets:keys      # clés age opérateur et cluster, hors du dépôt (à sauvegarder hors machine)
task secrets:init      # crée tous les *.sops.yaml manquants (valeurs aléatoires fortes)
task secrets:pending   # liste ce qu'il reste à renseigner à la main (valeurs de site, jeton Proxmox, OVH, Discord, SMTP...)
sops secrets/proxmox.sops.yaml
task phase:0-prereqs   # tri des valeurs exigibles maintenant ; secrets:check ne sera OK qu'à la fin du déploiement
```

!!! warning "Sauvegardez les clés privées age"
    Sans la clé opérateur, les secrets du dépôt sont illisibles. Sans la clé du cluster, ArgoCD ne peut plus
    déchiffrer les Secrets Kubernetes. Elles ne sont jamais dans le dépôt.

## 3. Déployer

```bash
task up
```

`task up` enchaîne, dans l'ordre et de façon idempotente :

1. réseau de l'hôte (`vmbr2`) et réglages de l'hôte (Ansible) ;
2. routeur OPNsense, image Talos, règles du pare-feu ;
3. LXC de services, DNS public, puis leur configuration par Ansible, première passe (monitoring, Authentik, edge) ;
4. configuration d'Authentik (OIDC, groupes, flows, MFA du staff), recopie des secrets OIDC générés dans les sops (`secrets:oidc-sync`), puis seconde passe Ansible (Warpgate, NetBird, Grafana) ;
5. cluster `kind` éphémère, Cluster API, cluster `pad-prod`, pivot ;
6. ArgoCD et l'Application `root`, qui synchronise la plateforme puis les applications ;
7. accès NetBird et Warpgate, puis smoke tests.

Chaque phase peut être relancée seule (`task tofu:apply-stack STACK=60-opnsense-rules`, `task bootstrap:gitops`...).
Voir [Tâches `task`](reference/taches.md) et le détail pas à pas dans le [runbook up](runbooks/up.md).

## 4. Actions manuelles

Quelques actions ne sont pas automatisables (policy NetBird par défaut, jeton de `netbird-sync`, clés du captcha, enrôlement MFA du premier administrateur,
clé cosign, règle d'accès Zot, règles OPNsense des routing peers, protection de la branche `main`, fichiers de verrouillage). Elles sont toutes dans
[Actions manuelles après déploiement](operations/actions-post-deploiement.md). Ne pas ouvrir l'événement aux joueurs
avant de les avoir faites.

## 5. Vérifier

```bash
task verify
```

Le script contrôle les endpoints publics, la découverte OIDC, la santé du front, les nœuds Kubernetes, l'état
Synced/Healthy des Applications ArgoCD, l'isolement de la zone CHALLENGES et VictoriaMetrics. Il doit être lancé
depuis un poste connecté à NetBird (ou passant par le bastion).

## Et ensuite

- Créer le premier compte manager dans Authentik (groupe `ctf-managers`) puis suivre le
  [guide manager](manager/index.md).
- Régler les alertes : [Supervision](architecture/supervision.md).
- Faire une [sauvegarde](runbooks/backup-restore.md) avant tout changement lourd.
