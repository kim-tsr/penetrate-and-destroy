# ADR 4 : Système du cluster : Talos Linux

**Statut** : acceptée.

## Contexte

Les nœuds Kubernetes doivent être jetables, identiques et sans dérive de configuration.

## Décision

**Talos Linux** : immuable, entièrement piloté par API, sans SSH ni shell. L'image vient d'Image Factory avec un schematic minimal (`siderolabs/qemu-guest-agent`), convertie en template de VM par la stack `15-talos-image`. La configuration des machines est générée par les providers Cluster API pour Talos.

## Alternatives écartées

- **Debian/Ubuntu + kubeadm** : un OS complet à durcir et à mettre à jour.
- **k3s** : simple, mais l'OS reste à gérer, et on perd l'immutabilité.
- **Flatcar, Fedora CoreOS** : immuables aussi, mais moins intégrés à Cluster API et sans API de gestion unifiée.

## Conséquences

- Pas de SSH : le diagnostic passe par `talosctl` et par le bastion (API Talos, port 50000). Voir [nœuds Kubernetes](../runbooks/kubernetes-nodes.md).
- Les montées de version passent par le contrat (`kubernetes.talos_version`, `kubernetes_version`) et le schematic doit rester cohérent avec l'image d'installation.
