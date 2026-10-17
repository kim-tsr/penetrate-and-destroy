# ArgoCD

**Couche** : Plateforme GitOps · **Où** : pods du cluster (namespace `argocd`, pool platform) · **Version** : chart argo-cd 10.10.5

## À quoi elle sert ici et pourquoi ce choix

Après le bootstrap, **plus rien n'est appliqué à la main** : ArgoCD réconcilie le cluster avec `gitops/`. Une Application `root` synchronise le socle
`gitops/platform` ; un ApplicationSet `apps` crée une Application par dossier de `gitops/apps/*`. ArgoCD gère aussi sa propre configuration et les
objets Cluster API du cluster lui-même. Décision : [ADR 7](../adr/007-gitops-argocd.md).

## Où elle tourne et comment elle est déployée

Installé par `bootstrap/scripts/gitops.sh` (Helm, mêmes valeurs que l'Application), qui crée aussi le Secret `sops-age` (clé du **cluster**), le Secret du dépôt
(clé de déploiement) et l'Application `root`. Il s'auto-gère ensuite (sync-wave -5). L'ordre d'installation des composants est porté par les `sync-wave`
(voir [Bootstrap](../architecture/bootstrap.md)).

## Version épinglée

Chart `argo-cd` 10.10.5 dans `gitops/platform/argocd/application.yaml` ; init container `alpine:3.24.2@sha256:...` pour ksops (`gitops/platform/argocd/values.yaml`).

## Fichiers de configuration dans le dépôt

- `gitops/bootstrap/root.yaml` : AppProjects `platform`, `apps`, `cluster`, Application `root`, ApplicationSet `apps`.
- `gitops/platform/argocd/values.yaml` et `application.yaml`.
- `gitops/platform/kustomization.yaml` : liste des Applications du socle.

## Interactions avec les autres briques

- Lit le dépôt Git par SSH sur le port 443 (`git.ssh` du contrat = `ssh://git@ssh.github.com:443/...`, les zones n'ayant d'egress qu'en 80/443 ; clé de déploiement ; un `repoURL` HTTPS ne correspondrait pas au Secret `repo-pad` : « authentication required ») et déchiffre via [ksops](sops-age-ksops.md).
- Authentifie par [Authentik](authentik.md) (client `pad-argocd`, **seul** le groupe `infra-admins` est admin ; `ctf-admins`, qui n'administre qu'un événement, n'a aucun accès).
- Applique tous les composants : [Cilium](cilium-hubble.md), [Kyverno](kyverno.md), [cert-manager](cert-manager.md), les [applications CTF](ctfd.md)...

## Sécurité

- SSO uniquement : le compte local `admin` est désactivé dès le bootstrap (secours : `argocd login --core` avec les droits `kubectl` de l'opérateur) ; politique RBAC par défaut vide, aucun droit hors `infra-admins`.
- Une PR qui touche le RBAC, `gitops/bootstrap/root.yaml` ou un `ClusterRoleBinding` se relit comme un changement de privilèges ; protéger la branche `main` ([procédure](../operations/protection-branche.md)).
- `exec.enabled: false` ; suivi des ressources par annotation (évite la capture des objets enfants Cluster API).
- Namespace en PSS `restricted` ; `server.insecure` car le TLS est terminé par Traefik.
- AppProjects distincts : le projet `apps` ne peut créer que des namespaces explicitement listés.

## Supervision

Alertes `ArgoCDOutOfSync`, `ArgoCDAppUnhealthy`, `ArgoCDSyncFailed` : [ArgoCD](../runbooks/argocd.md). Dashboard `pad-platform`.

## Opérations courantes

```bash
export KUBECONFIG="$PWD/.state/kubeconfig"
argocd app list                              # ou : kubectl -n argocd get applications
argocd app sync <application>
kubectl -n argocd get applications -o wide
```

## Pièges connus

- Sans le Secret `sops-age`, ksops échoue explicitement (le volume est `optional`) : vérifier qu'il existe après `bootstrap:gitops`.
- Ne pas faire de `kubectl apply` hors `bootstrap/` : la prochaine synchronisation annule la modification.
- Les Applications de providers CAPI et du `Cluster` portent des garde-fous (`Prune=false`) : ne pas les retirer.

## Documentation officielle

[argo-cd.readthedocs.io](https://argo-cd.readthedocs.io/)

[Retour à l'index des composants](index.md){ .md-button }
