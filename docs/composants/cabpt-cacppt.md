# CABPT et CACPPT (providers Talos)

**Couche** : Cluster Kubernetes · **Où** : pods du cluster · **Version** : CABPT v0.6.13, CACPPT v0.5.14 (contrat v1beta1)

## À quoi elle sert ici et pourquoi ce choix

**CABPT** (bootstrap provider) génère la configuration machine Talos de chaque nœud ; **CACPPT** (control plane provider) pilote le `TalosControlPlane` :
amorçage, ajout de membres etcd, montées de version. Ils sont les équivalents Talos de kubeadm. Ils produisent aussi le `talosconfig` du cluster.

## Où elle tourne et comment elle est déployée

Installés par `clusterctl init` puis adoptés par ArgoCD (`gitops/platform/capi-providers/manifests/bootstrap-talos.yaml` et `control-plane-talos.yaml`).

## Version épinglée

`kubernetes.capi.bootstrap_talos: v0.6.13` et `kubernetes.capi.control_plane_talos: v0.5.14` dans `infra/contracts.yaml`. Le contrat v1beta1 est toléré jusqu'à CAPI v1.16.

## Fichiers de configuration dans le dépôt

- `gitops/clusters/prod/control-plane.yaml` (`TalosControlPlane`, `strategicPatches`) ; `pool-*.yaml` (`TalosConfigTemplate`).
- `gitops/platform/capi-providers/manifests/`.

## Interactions avec les autres briques

Consomment les objets de [Cluster API](cluster-api.md), produisent la config exécutée par [Talos](talos.md), s'appuient sur [CAPMOX](capmox.md) pour les VM.

## Sécurité

Le secret `pad-prod-talosconfig` est dans le cluster ; extrait vers `.state/talosconfig` (ignoré par Git). Aucun SSH n'est ouvert.

## Supervision

Santé du control plane : `kubectl get taloscontrolplane` ; alertes de nœuds : [Nœuds Kubernetes](../runbooks/kubernetes-nodes.md).

## Opérations courantes

```bash
kubectl -n pad-cluster get taloscontrolplane,talosconfigtemplates
kubectl -n pad-cluster get secret pad-prod-talosconfig -o jsonpath='{.data.talosconfig}' | base64 -d > .state/talosconfig
```

## Pièges connus

Ces providers sont encore en contrat v1beta1 alors que CAPI et CAPMOX sont en v1beta2 : surveiller la compatibilité avant de monter CAPI au-delà de v1.16.

## Documentation officielle

[github.com/siderolabs/cluster-api-bootstrap-provider-talos](https://github.com/siderolabs/cluster-api-bootstrap-provider-talos)

[Retour à l'index des composants](index.md){ .md-button }
