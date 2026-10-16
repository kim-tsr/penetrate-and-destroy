# Images signées et épinglées

Trois garde-fous complémentaires protègent la plateforme contre une image arbitraire ou remplacée après revue.

| Niveau | Où | Effet |
|---|---|---|
| Schéma `challenge.yml` | import ZIP / dépôt Git, validé par CTFd | `instance.image` doit être sous `registry.pad.internal/ctf/` et épinglée par `@sha256:` |
| Scénario chall-manager | `apps/chall-manager-scenario` (`PAD_IMAGE_PREFIX`) | même règle, refus avant toute création de ressource |
| Kyverno `restrict-instance-images` | pods `inst-*`, toujours en `Enforce` | refus à l'admission de toute image hors préfixe ou sans empreinte |
| Kyverno `verify-images` / `verify-images-audit` | pods `inst-*`, `ctfd`, `frontend`, `netbird-sync` | vérification des signatures cosign, `Audit` par défaut puis `Enforce` |

Valeurs de référence : `infra/contracts.yaml`, bloc `instances` (`image_prefix`, `image_verification`).

## Mode de vérification des signatures

Le ConfigMap `kyverno/pad-image-policy` (`gitops/platform/kyverno/policies/image-policy-configmap.yaml`) pilote deux
politiques exclusives :

| `mode` | Politique active | Effet |
|---|---|---|
| `audit` (défaut) | `verify-images-audit` (`failurePolicy: Ignore`) | violations rapportées dans les PolicyReports, rien n'est bloqué |
| `enforce` | `verify-images` (`failurePolicy: Fail`) | image non signée ou sans empreinte refusée |

Garde-fou : tant que `cosign.pub` contient `CHANGEME`, la vérification du **registre interne** reste en audit même si
`mode: enforce`, pour ne pas empêcher toutes les instances de démarrer avec une clé invalide. Les images du projet sur
ghcr.io sont vérifiées en keyless et n'utilisent pas cette clé.

`failurePolicy: Fail` signifie qu'un Kyverno indisponible bloque la création de pods dans `inst-*`, `ctfd`, `frontend`
et `netbird-sync` (le webhook est limité à ces namespaces par `matchConditions` ; `kube-system` et `kyverno` ne sont jamais
concernés). Le contrôleur d'admission Kyverno tourne en 2 réplicas sur le pool platform (PDB `minAvailable: 1`) : voir le [runbook Kyverno](../runbooks/kyverno.md).

## Passer en Enforce

1. Générer la paire de clés : `cosign generate-key-pair`. La clé privée va dans SOPS (secrets de la CI du dépôt privé de
   challenges), jamais dans ce dépôt.
2. Remplacer `cosign.pub` dans `image-policy-configmap.yaml` par la clé publique.
3. Faire signer par la CI du dépôt privé chaque image de challenge poussée dans Zot
   (`cosign sign --key ... registry.pad.internal/ctf/<image>@sha256:...`), sinon elle sera refusée.
4. Lire les rapports : `kubectl get policyreport -A -o json | jq '.items[].results[]? | select(.policy|startswith("verify-images"))'`.
   Aucune violation attendue pour les images en cours d'utilisation.
5. Dans le **même commit**, passer `mode: enforce` dans le ConfigMap et `instances.image_verification: enforce` dans
   `infra/contracts.yaml`.
6. Retour arrière : repasser `mode: audit`. Aucune autre modification n'est nécessaire.

## Images de la plateforme (ctfd, frontend, netbird-sync)

Les images `ghcr.io/<propriétaire du dépôt>/pad-*` sont construites, poussées et signées (cosign keyless, identité du workflow
`images.yml`) par la CI. Les manifests `gitops/apps/*/deployment.yaml` les référencent en `tag@sha256:<empreinte>`.

Flux de mise à jour (automatique) :

1. Sur push `main`, `images.yml` construit, scanne, pousse et signe chaque image (`ghcr.io/<propriétaire>/pad-<nom>:<sha court>`)
   et affiche son empreinte dans le résumé du job (`Résumé du digest`).
2. Une fois toutes les images publiées, le job `pin-digests` exécute `scripts/pin-image-digests.sh <propriétaire> <sha court>`.
   Le script lit l'empreinte de l'index OCI dans le registre et réécrit les références `tag@sha256` de
   `gitops/apps/{ctfd,frontend,netbird-sync}/deployment.yaml` et l'empreinte de `challenges/*/challenge.yml`
   (`registry.pad.internal/ctf/<nom>` : l'empreinte est la même dans Zot si l'image y est copiée à l'identique, par exemple
   `crane copy ghcr.io/<propriétaire>/pad-chal-<nom>:<sha> registry.pad.internal/ctf/<nom>:<version>`).
3. Si quelque chose change, le job ouvre (ou met à jour) la PR `ci/pin-image-digests`, titre `chore(images): épingler les
   empreintes des images`. Après relecture, le merge déclenche le déploiement par ArgoCD. Un push dont le message commence
   par `chore(images)` ne relance pas le job (pas de boucle).
4. Renovate ignore ces images (règle `enabled: false` dans `renovate.json`) pour ne pas entrer en conflit avec ce flux ; il
   continue de suivre les images de base et les autres dépendances.

Prérequis côté dépôt : soit le secret `PAD_BOT_TOKEN` (PAT ou token d'application, droits `contents` et `pull-requests`),
auquel cas la CI s'exécute sur la PR ; soit le réglage « Allow GitHub Actions to create and approve pull requests », la PR
étant alors créée avec `GITHUB_TOKEN` (GitHub n'y déclenche pas la CI : la rouvrir ou y pousser un commit vide). Les commits
du job sont signés `github-actions[bot]`. Pour une mise à jour manuelle :
`scripts/pin-image-digests.sh <propriétaire> <sha court>` (outils : `crane` ou `docker buildx`).

Tant que l'empreinte est nulle (`sha256:000…`, cas de `pad-frontend` tant qu'il n'est pas publié), l'image ne démarre pas :
c'est volontaire. L'Application concernée reste `Degraded` jusqu'à la première publication, puis la PR l'épingle.

!!! note "Points à vérifier au premier déploiement"
    - L'identité keyless attendue est `.github/workflows/images.yml` sur `main` ou un tag `v*` du dépôt du contrat
      (`git.repo`). Une image construite depuis une autre branche ou un fork est refusée en `enforce`.
    - L'admission controller Kyverno doit joindre ghcr.io et `*.sigstore.dev` (Rekor, Fulcio, TUF) : règles ajoutées à la
      CiliumNetworkPolicy du namespace `kyverno`. Si les pods plateforme sont lents à démarrer, vérifier ce flux et le
      flux platform vers Internet (variable `internet_egress_zones` de la stack `60-opnsense-rules`).
    - Les nœuds challenges tirent les images de `registry.pad.internal/ctf/` : la configuration de Zot
      (`gitops/platform/zot/values.yaml`) définit la règle d'accès `ctf/**` (écriture pour la CI, lecture pour
      `pad-pull`). Reste à fournir les identifiants de `pad-pull` aux nœuds (configuration de registre Talos, hors Git).
      Marche à suivre : [Actions manuelles](actions-post-deploiement.md) (action 8).
