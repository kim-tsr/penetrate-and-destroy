# Limites connues et points à valider

Cette page liste honnêtement ce qui n'est pas terminé ou n'a pas encore été vérifié sur du matériel réel. Elle reprend
et complète la section « Avancement » du [plan](../PLAN.md). À mettre à jour après chaque déploiement réel.

## Non vérifié sur un cluster réel

Le développement s'est fait sans accès à un serveur : les validations sont statiques (lint, `validate`, `kubeconform`,
tests unitaires, mocks). Les points suivants restent à confirmer au premier déploiement.

| Zone | À vérifier |
|---|---|
| OPNsense | import de configuration par frappes clavier (fenêtre de temps, console VGA ou série), nom des interfaces VLAN `vlan0.<tag>` pour OPNsense 25.7, accès à `https://10.20.10.1` depuis le poste opérateur |
| tofu | providers compilés depuis les sources pendant le développement (registry bloqué) : générer les `.terraform.lock.hcl` (`task tofu:lock`) ; le provider NetBird est jeune (0.0.x) |
| Cluster API | adoption par ArgoCD (server-side apply) des objets CAPI après le pivot ; contrat v1beta1/v1beta2 entre providers |
| Alloy | chart 1.13.1 et certificats kubelet |
| Zot | labels et métriques ; politique `verify-images` en `Audit` tant que la clé cosign est un placeholder |
| ksops | téléchargement du binaire par l'initContainer du repo-server |
| Front | image construite et démarrée dans le cluster ; seuil KEDA (150 sessions par réplica) à calibrer avec `task load` |
| e2e | pile docker compose jamais démarrée (pas de Docker dans l'environnement de développement) |
| Authentik, NetBird | noms de métriques NetBird et CrowdSec à confirmer ; doublons de groupes JWT NetBird |

## Fonctionnalités incomplètes

| Sujet | État |
|---|---|
| Clés S3 de CTFd | recopiées à la main : le Job `garage-init` doit lire des clés fournies en SOPS (secret `garage-s3-credentials`) |
| Statut de synchronisation Git | le front le lit via `PAD_GIT_SYNC_STATUS_URL`, mais la CI du dépôt privé qui le publie n'est pas fournie |
| Blocages OPNsense | pas encore collectés dans Loki (syslog) ; consultables dans l'interface d'OPNsense |
| Policy NetBird « Default » | à supprimer à la main |
| PAT de `netbird-sync` | à créer à la main |
| Alertmanager | pas encore derrière le forward-auth Authentik |
| `flake.lock` | à générer sur une machine avec accès aux registries ; `promtool`, `amtool`, `vmalert` pas encore dans le devshell |
| Configuration OIDC de Warpgate | côté Ansible, pas tofu (limite du provider) ; les modifications faites dans l'interface sont écrasées |
| IdP de NetBird | configuré par Ansible ; le code tofu existe mais est désactivé (`manage_identity_provider`) |

## Limites d'architecture

| Limite | Conséquence | Contournement |
|---|---|---|
| un seul hôte physique | pas de haute disponibilité : l'hôte est un point de défaillance unique | sauvegardes, reconstruction rapide |
| control plane Kubernetes à 1 réplica | perte du control plane = API indisponible (workloads existants intacts) | reconstruire ; passer à 3 réplicas si la RAM le permet |
| chall-manager à 1 réplica | stockage RWO | attendre un stockage RWX ou une base externe |
| supervision sur un seul LXC | une panne totale du LXC supprime mesure et alerte | second point de vue externe (non fourni) |
| Uptime Kuma sur le même LXC que la stack | idem | sonde externe indépendante |
| 100 adresses d'instances | plafond d'instances simultanées (pool `10.20.70.100`-`.199`) | élargir le pool dans le contrat |
| ressources (budget cible d'environ 26 Go de RAM) | 3 workers `challenges` au plus | relever les bornes si l'hôte dispose de plus de ressources ([Scaling](../architecture/scaling.md)) |
| instances sans Internet | pas d'egress sauf allowlist (`challenges_egress_allowlist`) | déclarer l'allowlist par challenge |
| OIDC et SSH sur Warpgate | OIDC ne couvre que l'interface web ; SSH par clé ou lien web | compte local `admin` en secours |
| pas de flag dynamique par `challenge.yml` | pas de champ `instance.env` ; le flag par instance se règle côté plugin/scénario | API admin CTFd |
| suppression de challenge via Git | non synchronisée | supprimer dans CTFd |

## Sécurité

La revue de sécurité croisée est une étape planifiée du projet (voir le [plan](../PLAN.md)). Tant qu'elle n'a pas eu
lieu et que les points « non vérifié » ci-dessus ne sont pas levés, ne pas exposer la plateforme à des participants
non fiables sans avoir parcouru les [actions post-déploiement](../operations/actions-post-deploiement.md).

## Signaler un défaut de la documentation

Si une page ne correspond pas à ce que vous observez sur votre installation, corrigez la page dans le même commit que le
correctif du code : la documentation fait partie de la définition de « terminé ».
