# Nix (devshell)

**Couche** : Outillage et CI · **Où** : poste opérateur, CI · **Version** : nixpkgs 25.05 (figé par `flake.lock`)

## À quoi elle sert ici et pourquoi ce choix

`nix develop` fournit **tous** les outils aux versions figées par `flake.lock` (OpenTofu, Ansible, kubectl, Helm, kustomize, kind, clusterctl, talosctl, cilium-cli, argocd, kubeconform, sops, age, go-task, Go,
Node, pnpm, Python, cosign, trivy, k6...). Chaque contributeur et la CI exécutent donc les mêmes binaires.

`clusterctl` et `talosctl` (comme `kind` et OpenTofu) sont épinglés par le devshell à la version du contrat (`kubernetes.capi.core`, `kubernetes.talos_version`) : binaires officiels vérifiés par sha256, nixpkgs étant en retard.

## Où elle tourne et comment elle est déployée

Sur le poste de l'opérateur : `nix develop`. En CI : `cachix/install-nix-action` puis `nix develop -c <commande>`. Le shell positionne `SOPS_AGE_KEY_FILE`, `KUBECONFIG` et `TALOSCONFIG`.

## Version épinglée

`flake.nix` (entrée `nixpkgs/nixos-25.05`) et `flake.lock` (révision exacte). Le `flake.lock` n'est jamais commité depuis un worktree d'agent : il est régénéré sur la branche principale.

## Fichiers de configuration dans le dépôt

`flake.nix`, `flake.lock`.

## Interactions avec les autres briques

Fournit les outils à [Taskfile](taskfile.md), [OpenTofu](opentofu.md), [Ansible](ansible.md), aux scripts de lint et à [GitHub Actions](github-actions.md).

## Sécurité

`allowUnfree = false` ; paquets issus du cache Nix, versions figées ; `gitleaks`, `trivy` et `checkov` font partie de l'environnement.

## Supervision

Aucune. Les checks de la CI sont l'indicateur de santé de l'outillage.

## Opérations courantes

```bash
nix develop                    # shell interactif
nix develop -c task lint       # une commande sans entrer dans le shell
```

## Pièges connus

- Dans l'environnement cloud des agents, `nix develop` peut échouer (accès GitHub bloqué pour `flake-utils`) : les agents installent leurs outils autrement.
- `promtool`, `amtool` et `vmalert` ne sont pas encore dans le devshell : les surcharger avec `PROMTOOL`, `AMTOOL`, `VMALERT` (voir `monitoring/README.md`).

## Documentation officielle

[nixos.org](https://nixos.org/manual/nix/stable/)

[Retour à l'index des composants](index.md){ .md-button }
