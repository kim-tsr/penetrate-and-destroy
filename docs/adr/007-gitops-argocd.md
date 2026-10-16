# ADR 7 : GitOps : ArgoCD dans le cluster de production

**Statut** : acceptée.

## Contexte

Tout ce qui tourne dans Kubernetes doit être déclaré dans le dépôt, reproductible, et dérive visible.

## Décision

**ArgoCD** tourne dans `pad-prod` et se gère lui-même. L'Application `root` synchronise le socle (`gitops/platform`), un ApplicationSet crée une Application par dossier `gitops/apps/*`, et une Application `cluster-prod` synchronise les manifestes Cluster API. Les Secrets sont déchiffrés par ksops. Les charts Helm sont référencés en multi-source (chart épinglé + values du dépôt).

## Alternatives écartées

- **Flux** : excellent aussi, mais l'UI d'ArgoCD et les ApplicationSets conviennent mieux à l'exploitation à vue.
- **Helm manuel / `kubectl apply`** : interdit hors `bootstrap/` : aucune traçabilité.
- **Pipeline CI qui applique** : pas de réconciliation continue ni de détection de dérive.

## Conséquences

- Le dépôt est la seule source de vérité : un changement urgent se fait aussi par commit (voir [ArgoCD](../runbooks/argocd.md)).
- La clé du **cluster** (pas celle de l'opérateur) est injectée pour ksops.
