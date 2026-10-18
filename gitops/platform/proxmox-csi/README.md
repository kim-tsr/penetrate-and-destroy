# proxmox-csi : volumes persistants sur ZFS

- Chart `proxmox-csi-plugin` 0.5.12 (OCI `ghcr.io/sergelogvinov/charts`), namespace `csi-proxmox`.
- StorageClass par défaut `pad-zfs` sur le datastore `host.datastore_vm`, région et zone = `pve` (`host.node`).
  Mode `WaitForFirstConsumer`, expansion activée, `reclaimPolicy: Delete`.
- Les nodes doivent porter les labels `topology.kubernetes.io/region` et `topology.kubernetes.io/zone` = `pve`
  (posés par le cloud controller manager Proxmox, `gitops/platform/proxmox-ccm`).
- Le node plugin tolère le taint `pad.io/pool` : il tourne aussi sur le pool challenges.

## Secret de configuration

Le chart lit `proxmox-csi-config` (clé `config.yaml`, namespace `csi-proxmox`). Le modèle est `secret.example.yaml`
(valeurs `CHANGEME`). Il n'est pas dans `kustomization.yaml` : seule la version chiffrée est déployée.
Le cloud controller manager (`gitops/platform/proxmox-ccm`) lit le même Secret : `features.provider` doit valoir `capmox`
(providerID `proxmox://<uuid>` de CAPMOX ; le bootstrap le vérifie).

1. Créer l'utilisateur et le token côté Proxmox (rôle minimal, privilege separation activée) :
   ```bash
   pveum role add CSI -privs "VM.Audit VM.Config.Disk Datastore.Allocate Datastore.AllocateSpace Datastore.Audit Sys.Audit"
   pveum user add csi@pve
   pveum aclmod / -user csi@pve -role CSI
   pveum user token add csi@pve csi --privsep 0
   ```
2. `task secrets:init` crée `secret.sops.yaml` (chiffré) à partir de `secret.example.yaml` ; le compléter avec
   `sops gitops/platform/proxmox-csi/secret.sops.yaml` (`token_secret`, et `insecure: false` si le certificat est approuvé).
   Un fichier créé avant l'arrivée du CCM porte `provider: default` : le passer à `capmox`.
3. Le générateur ksops `secret-generator.yaml` est déjà référencé par `kustomization.yaml`. Ne jamais commiter la version
   non chiffrée (voir docs/SECRETS.md).

L'URL de l'API passe par `host.mgmt_ip` (10.20.10.2) : les nodes (VLAN 60) doivent pouvoir joindre le port 8006 (matrice de flux OPNsense).

- La `region` du Secret (chiffré) et celle de la StorageClass doivent être égales (`host.node`) : `task site:set` /
  `site:sync` réécrivent aussi les lignes marquées des fichiers `*.sops.yaml` (déchiffrés en mémoire, rechiffrés).
