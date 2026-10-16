# SOPS, age et ksops

**Couche** : Plateforme GitOps · **Où** : poste opérateur (sops, age), repo-server ArgoCD (ksops), CI (clé éphémère) · **Version** : ksops v4.5.1 ; sops et age du devshell

## À quoi elle sert ici et pourquoi ce choix

Le dépôt est public : les secrets y sont **commités chiffrés** (SOPS + age) et jamais en clair. Deux clés age distinctes : celle de l'**opérateur** (déchiffre tout)
et celle du **cluster** (ne déchiffre que `gitops/**`, jamais `secrets/`). Décision : [ADR 8](../adr/008-secrets-sops.md) ; procédure : [Secrets (SOPS + age)](../SECRETS.md).

## Où elle tourne et comment elle est déployée

- Poste opérateur : `sops`/`age` du devshell ; clé dans `~/.config/sops/age/keys.txt` (variable `SOPS_AGE_KEY_FILE`).
- Cluster : ksops (plugin exec de kustomize) est téléchargé par un init container du repo-server ArgoCD (binaire épinglé, sha256 vérifié) ; la clé du cluster arrive par le Secret `sops-age`.
- Ansible et tofu déchiffrent à l'exécution via `community.sops` et `carlpett/sops`.

## Version épinglée

| Élément | Version | Où |
|---|---|---|
| ksops | v4.5.1 (sha256 vérifié) | `gitops/platform/argocd/values.yaml` (init container `install-ksops`) |
| `community.sops` | 2.5.0 | `infra/ansible/requirements.yml` |
| `carlpett/sops` | 1.4.1 | `infra/tofu/stacks/*/versions.tf` ([page](tofu-sops.md)) |
| sops, age | version du devshell | `flake.nix` / `flake.lock` |

## Fichiers de configuration dans le dépôt

- `.sops.yaml` : recipients (opérateur, cluster) et règles de chemin (`secrets/*.sops.yaml`, `gitops/**/*.sops.yaml`, `infra/**`).
- `secrets/*.example.yaml` et `gitops/**/*.example.yaml` : modèles en `CHANGEME`.
- `scripts/sopsctl.py`, `scripts/Taskfile.secrets.yml` (`task secrets:*`), `scripts/check-sops.sh`, `scripts/validate-gitops.sh`.
- `gitops/**/secret-generator.yaml` : générateur ksops de chaque composant.

## Interactions avec les autres briques

Consommé par [ArgoCD](argocd.md), [Ansible](ansible.md), [OpenTofu](opentofu.md), les scripts de bootstrap, de sauvegarde et de restauration ; la CI n'a jamais la vraie clé.

## Sécurité

- Seuls `data` et `stringData` des Secrets Kubernetes sont chiffrés ; les fichiers d'infra le sont entièrement.
- Garde-fous avant commit : `bash scripts/check-sops.sh` (blocs `sops:`, valeurs `ENC[...]`, pas de Secret ni de clé en clair) et `bash scripts/check-site-leaks.sh`.
- La CI chiffre les modèles avec une **clé éphémère** pour valider `kustomize build` : jamais la vraie clé.
- Les clés privées age ne vont jamais dans le dépôt (`*.agekey`, `keys.txt` sont ignorés).

## Supervision

Pas de métrique propre ; un échec ksops se voit dans l'état de synchronisation d'ArgoCD : [ArgoCD](../runbooks/argocd.md). Rotation : [Rotation des secrets](../runbooks/rotation-secrets.md).

## Opérations courantes

```bash
task secrets:keys            # génère les clés age hors dépôt, renseigne .sops.yaml
task secrets:init            # crée les *.sops.yaml manquants (valeurs aléatoires fortes)
task secrets:pending         # liste les valeurs encore à renseigner (noms seulement)
task secrets:check
sops secrets/proxmox.sops.yaml
task secrets:rotate-cluster-key
```

## Pièges connus

- Sauvegarder les **deux** clés privées hors machine : sans elles, plus rien ne se déchiffre.
- Après tout changement de recipient : `task secrets:update-keys`.
- Les valeurs partagées (secret SSO, mot de passe Valkey, clé S3...) sont générées **une seule fois** et recopiées à l'identique : ne pas les régénérer d'un seul côté.

## Documentation officielle

[getsops.io](https://getsops.io/) · [age-encryption.org](https://age-encryption.org/) · [github.com/viaduct-ai/kustomize-sops](https://github.com/viaduct-ai/kustomize-sops)

[Retour à l'index des composants](index.md){ .md-button }
