# Zot (registry OCI)

**Couche** : Plateforme GitOps · **Où** : pod du cluster (namespace `registry`), `registry.pad.internal` · **Version** : chart 0.1.128, image v2.1.22

## À quoi elle sert ici et pourquoi ce choix

Héberge les images des challenges instanciés, le scénario OCI de chall-manager et les artefacts internes, avec **recherche et scan CVE (Trivy)** intégrés et métriques.
Un registry interne évite de dépendre d'un registry public pour des images de challenges. Décision : [ADR 13](../adr/013-registry-zot.md).

Zot sert aussi de **cache pull-through** des registres publics pour les nœuds de la zone CHALLENGES, qui n'ont aucun
egress Internet (voir [Miroir pull-through](#miroir-pull-through-zone-challenges)).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/zot` (vague -2), un réplica, volume 30 Gi `pad-zfs`, Ingress Traefik sur `registry.pad.internal` (nom interne, jamais publié ; override Unbound vers l'ingress `10.20.60.200`, stack `60-opnsense-rules`), certificat `zot-tls` émis par la CA interne `pad-internal-ca` (cert-manager), GC toutes les 6 h.

## Version épinglée

Chart `zot` 0.1.128 dans `gitops/platform/zot/application.yaml` ; image `ghcr.io/project-zot/zot:v2.1.22@sha256:...` dans `values.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/zot/values.yaml` (configuration JSON : stockage et rétention, auth htpasswd, contrôle d'accès, extensions `sync`/`search`/`cve`/`metrics`).
- `gitops/platform/namespaces/resources/registry.yaml` (CiliumNetworkPolicy : entrée depuis Traefik, sortie HTTPS vers Internet pour la synchronisation et la base Trivy).
- `resources/podmonitor.yaml`, `secret.example.yaml` (htpasswd), `secret-metrics.example.yaml`.

## Interactions avec les autres briques

Alimenté par la [CI](github-actions.md) (`pad-ci`) ; lu par [chall-manager](chall-manager.md) et le cluster (`pad-pull`) ; images contrôlées par [Kyverno](kyverno.md) ([cosign et Trivy](cosign-trivy.md)).

## Sécurité

- Authentification htpasswd obligatoire (hash bcrypt, mots de passe en clair dans `secrets/credentials.sops.yaml`).
- Contrôle d'accès : `pad/**` et `ctf/**` réservés à `pad-ci` (lecture, création, mise à jour, suppression) et `pad-pull` (lecture), `defaultPolicy: []` ; `public/**` et `mirror/**` en lecture anonyme ; métriques pour l'utilisateur `metrics`.
- **Images de challenges (`ctf/**`)** : le préfixe `registry.pad.internal/ctf/` est imposé aux instances ([scénario](chall-manager-scenario.md), [Kyverno](kyverno.md)) ; la règle d'accès `ctf/**` est dans `values.yaml`. Les nœuds challenges doivent encore recevoir les identifiants de `pad-pull` (configuration de registre Talos, hors Git : [Actions manuelles](../operations/actions-post-deploiement.md), action 8).
- Interface interne uniquement.

## Miroir pull-through (zone CHALLENGES)

**Pourquoi.** Les workers du pool `challenges` (VLAN 70) n'ont aucun egress Internet, par conception : les instances
des joueurs ne doivent pas sortir, et la variable `challenges_egress_allowlist` de la stack `60-opnsense-rules` reste
vide. Or un nœud Talos tire lui-même ses images système (kubelet `ghcr.io/siderolabs/kubelet`, pause
`registry.k8s.io/pause`) et celles des DaemonSets qui tournent sur tous les nœuds (Cilium, CSI Proxmox, Alloy,
node-exporter). Sans miroir, le worker ne démarre même pas son kubelet et ne rejoint jamais le cluster.

**Comment.** L'extension `sync` de Zot, en mode `onDemand` (pas de synchronisation périodique) : une requête sur
`registry.pad.internal/mirror/<registre>/<dépôt>` tire l'image du registre amont, la stocke, puis la sert.
Côté nœuds, `machine.registries.mirrors` du `TalosConfigTemplate` `pad-prod-challenges-v2` renvoie chaque registre
vers son préfixe (`overridePath: true`, pas de repli vers le registre public : `skipFallback: true`) ; c'est
transparent pour Kubernetes (les pods gardent `quay.io/cilium/cilium@sha256:...`, Kyverno voit le nom d'origine).

| Registre amont | Préfixe local | Dépôts autorisés (liste blanche `content`) | Images concernées |
|---|---|---|---|
| `registry-1.docker.io` | `mirror/docker.io/` | `grafana/**`, `library/busybox` | Alloy, busybox du smoke test `scripts/verify.sh` |
| `ghcr.io` | `mirror/ghcr.io/` | `siderolabs/**`, `sergelogvinov/**` | kubelet Talos, nœud CSI Proxmox |
| `quay.io` | `mirror/quay.io/` | `cilium/**`, `prometheus/**`, `prometheus-operator/**` | Cilium, node-exporter, config-reloader d'Alloy |
| `registry.k8s.io` | `mirror/registry.k8s.io/` | `pause`, `sig-storage/**` | pause (containerd), sidecars CSI |
| `factory.talos.dev` | `mirror/factory.talos.dev/` | `nocloud-installer/**` | installeur Talos (`talosctl upgrade`) |

Tout autre dépôt sous `mirror/` répond 404 (journal zot : `filtered out by content`) : le miroir n'est pas un accès
Internet détourné. **Ajouter un DaemonSet qui tourne sur le pool challenges** (ou changer de registre une image
existante) impose d'ajouter son dépôt à `content`, sinon ses pods restent en `ImagePullBackOff` sur ces nœuds.

**Choix et compromis.**

- **Préfixe `mirror/<registre>/`** plutôt qu'un registre Zot par amont : un seul Ingress, un seul certificat, et
  le nom du registre d'origine reste lisible dans le stockage et l'UI.
- **Empreintes conservées** : `http.compat: ["docker2s2"]` garde les manifestes Docker tels quels ; sans lui, zot les
  convertit en OCI, l'empreinte change et un pull par `@sha256` échoue (node-exporter, config-reloader, kubelet,
  pause sont publiés au format Docker).
- **Lecture anonyme** de `mirror/**` : ce sont des images publiques, et aucun identifiant n'a à être posé sur les
  nœuds (un nœud créé par l'autoscaler fonctionne tout seul, contrairement à `ctf/**`, action 8). L'écriture reste
  réservée à zot (la synchronisation ne passe pas par le contrôle d'accès) et à l'admin.
- **TLS** : certificat de la CA interne `pad-internal-ca` (indispensable : l'entrypoint `websecure` de Traefik est en
  `sniStrict`, sans certificat pour `registry.pad.internal` la poignée de main échoue). Les nœuds ne peuvent pas
  vérifier ce certificat : la CA est générée dans le cluster en phase 10, après l'écriture du template Talos (public
  et immuable), qui porte donc `tls.insecureSkipVerify: true` pour `registry.pad.internal`. Risque résiduel : un
  attaquant placé sur le chemin VLAN 70, OPNsense, VLAN 60 pourrait servir une image. Atténuations : pas d'identifiant
  exposé sur les miroirs (anonymes), images des DaemonSets épinglées par `@sha256` (containerd vérifie l'empreinte),
  chemin sans L2 partagé avec les joueurs (les pods d'instance n'ont aucun egress). Les images référencées par tag
  (kubelet, pause, nœud CSI) restent exposées à ce risque. Durcissement possible si l'on accepte un template propre au
  site : relever `ca.crt` du Secret `cert-manager/pad-internal-ca`, le poser en `tls.ca` (base64) dans un nouveau
  `TalosConfigTemplate` `-vN` et retirer `insecureSkipVerify`.
- **Rétention** : les images tirées par empreinte sont stockées sans tag ; la politique `mirror/**` les garde 30 jours
  après le dernier pull (sinon le GC les supprimerait au bout d'une heure). Une image absente est retirée de l'amont.
- **Stockage** : un jeu complet d'images de nœud (amd64) pèse environ 1 Go par version ; les 30 Gi suffisent,
  déduplication comprise. Surveiller l'espace du PVC lors des montées de version.

**Ordre de démarrage.** Zot n'existe qu'après la phase 10 : le pool `challenges` est donc créé par ArgoCD
(Application `cluster-prod`, vague 5) et non par `task bootstrap:cluster` (annotation `pad.io/bootstrap: gitops`).
Le worker rejoint le cluster quelques minutes après que Zot est `Healthy`. Flux réseau : règle OPNsense
`m10-chall-registry` (nœuds challenges vers l'ingress en 443), [matrice de flux](../architecture/flux.md).

**Vérifier** (depuis un poste staff) :

```bash
crane digest --insecure registry.pad.internal/mirror/ghcr.io/siderolabs/kubelet:v1.34.1   # = crane digest ghcr.io/siderolabs/kubelet:v1.34.1
crane digest --insecure registry.pad.internal/mirror/docker.io/library/alpine:3.20        # refusé (404) : hors liste blanche
kubectl -n registry logs sts/zot | grep -i '"sync'                                         # synchronisations à la demande
```

## Supervision

PodMonitor Zot ; panne : [Charges Kubernetes](../runbooks/kubernetes-workloads.md).

## Opérations courantes

```bash
sops -d --extract '["zot_pad_ci_password"]' secrets/credentials.sops.yaml
docker login registry.pad.internal -u pad-ci
cosign sign registry.pad.internal/pad/<image>@sha256:<digest>
```

## Pièges connus

- Le registry n'est joignable que depuis un poste staff NetBird, la CI et les nœuds challenges (miroir) : pas depuis Internet.
- Le certificat vient de la CA interne : `docker`, `crane`, `oras` ou `cosign` doivent faire confiance à `pad-internal-ca` (`kubectl -n cert-manager get secret pad-internal-ca -o jsonpath='{.data.ca\.crt}' | base64 -d`) ou être lancés en mode non vérifié (`--insecure`).
- Pod `ImagePullBackOff` sur un nœud challenges pour une image publique : dépôt absent de la liste blanche `content` (voir [Miroir pull-through](#miroir-pull-through-zone-challenges)).
- Les images d'instance doivent être référencées par empreinte (`@sha256:`) : pousser, relever le digest (`crane digest` ou la sortie de la CI), le reporter dans le `challenge.yml`, puis signer ce digest.
- Un seul réplica sur un PVC : à sauvegarder si les images ne sont pas reconstructibles.

## Documentation officielle

[zotregistry.dev](https://zotregistry.dev/)

[Retour à l'index des composants](index.md){ .md-button }
