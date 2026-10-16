# kind (bootstrap)

**Couche** : Cluster Kubernetes · **Où** : poste opérateur (Docker requis), le temps de `bootstrap:cluster` · **Version** : kind v0.33.0, nœud kindest/node:v1.34.11@sha256

## À quoi elle sert ici et pourquoi ce choix

Cluster API a besoin d'un cluster pour créer le premier cluster. `kind` joue ce rôle quelques minutes : il héberge les providers, crée `pad-prod`, puis lui
transmet la gestion (`clusterctl move`) et disparaît. Cela évite un cluster de gestion permanent.

## Où elle tourne et comment elle est déployée

`task bootstrap:cluster` (script `bootstrap/scripts/cluster.sh`) : crée kind, `clusterctl init`, applique `gitops/clusters/prod`, attend le control plane, installe cert-manager et Cilium, pivote, vérifie, supprime kind. **Reprenable** : si le pivot est fait, les étapes kind sont sautées ; si la vérification échoue, kind est conservé.

## Version épinglée

`kubernetes.kind_version: v0.33.0` et `kubernetes.kind_node_image: kindest/node:v1.34.11@sha256:44e222...` dans `infra/contracts.yaml` ; binaire `kind` du devshell ([Nix](nix.md)).

## Fichiers de configuration dans le dépôt

- `bootstrap/scripts/cluster.sh`, `lib.sh`, `capi-common.sh`, `destroy.sh` ; `bootstrap/Taskfile.yml`, `bootstrap/clusterctl.yaml`.

## Interactions avec les autres briques

Héberge temporairement [Cluster API](cluster-api.md) et ses providers ; crée `pad-prod` sur [Proxmox](proxmox-ve.md) ; la destruction recrée un kind frais (pivot inverse).

## Sécurité

Les identifiants Proxmox sont lus depuis SOPS et passés en variables d'environnement ; aucun fichier temporaire ne contient la clé age.

## Supervision

Aucune (éphémère). Diagnostic : sortie du script ; voir [Up](../runbooks/up.md).

## Opérations courantes

```bash
task bootstrap:cluster
kind get clusters
task bootstrap:destroy        # pivot inverse puis suppression de pad-prod
```

## Pièges connus

- Un Docker local est requis sur le poste de l'opérateur.
- Si le pivot échoue, kind est **conservé** : ne pas le supprimer à la main avant d'avoir compris l'état du `Cluster`.

## Documentation officielle

[kind.sigs.k8s.io](https://kind.sigs.k8s.io/)

[Retour à l'index des composants](index.md){ .md-button }
