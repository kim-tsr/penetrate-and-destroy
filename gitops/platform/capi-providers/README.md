# capi-providers : providers Cluster API gérés par ArgoCD

Le cluster `pad-prod` est **auto-hébergé**. Après le `clusterctl move`, les controllers CAPI qui
gèrent ses VMs tournent dans le cluster lui-même. ArgoCD les reprend à partir de manifests
**rendus et commités**.

## Approche retenue

1. Les versions sont épinglées dans `infra/contracts.yaml` → `kubernetes.capi.*`.
2. `task bootstrap:render-providers` exécute `clusterctl generate provider` pour chaque provider
   (core `cluster-api`, bootstrap `talos`, control-plane `talos`, infrastructure `proxmox`, ipam `in-cluster`).
   Cette commande rend exactement ce que `clusterctl init` applique (mêmes variables, celles de `bootstrap/clusterctl.yaml`).
3. Le rendu retire le Secret `capmox-manager-credentials` (aucune valeur en clair dans Git). Il est créé par
   `clusterctl init` (`bootstrap/scripts/capi-common.sh`, identifiants lus dans `secrets/proxmox.sops.yaml`) au bootstrap,
   puis jamais pruné par ArgoCD. Tant que la gestion des Secrets par GitOps n'est pas décidée, une rotation du token
   Proxmox se fait en modifiant ce Secret à la main puis en redémarrant `capmox-controller-manager`.
4. `manifests/inventory.yaml` reproduit l'inventaire clusterctl (objets `Provider`). Ainsi,
   `clusterctl move`, `clusterctl describe` et `clusterctl upgrade plan` restent cohérents avec ce qu'ArgoCD déploie.
5. L'Application `capi-providers` synchronise en Server-Side Apply, car certaines CRDs dépassent la
   limite d'annotation de `kubectl apply`. Elle ignore les `caBundle` injectés par cert-manager et
   **ne prune pas**. Les CRDs portent `Delete=false`.

Au bootstrap, `clusterctl init` (dans kind puis dans la cible) installe les **mêmes versions**.
ArgoCD adopte ensuite ces objets sans les recréer.

## Application ArgoCD

`application.yaml` (projet `platform`, sync-wave `-4`) : après cert-manager (`-7`, Certificates et injection des `caBundle`),
avant cluster-autoscaler (`-3`) et `cluster-prod` (`5`). Garde-fous : pas de prune, pas de finalizer, `Prune=false` sur
l'Application elle-même (l'Application `root` ne la supprime pas), `Delete=false` sur les CRDs et Namespaces.
`ignoreDifferences` sur les `caBundle` (webhooks, conversion des CRDs).

## Mise à jour d'un provider

```bash
yq -i '.kubernetes.capi.infrastructure_proxmox = "v0.9.2"' infra/contracts.yaml
task bootstrap:render-providers      # régénère manifests/*.yaml
git diff --stat gitops/platform/capi-providers/manifests
```

Avant de committer, vérifier :
- le contrat CAPI de la nouvelle version (`metadata.yaml` de la release) ;
- la matrice de compatibilité, en particulier CABPT et CACPPT, encore en contrat v1beta1, support que CAPI
  retirera en v1.16.

Après le merge, ArgoCD applique le rendu.
