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

Flux de mise à jour :

1. La CI publie l'image et affiche son empreinte dans le résumé du job (`Résumé du digest`).
2. Renovate (`:pinDigests`, `renovate.json`) propose la PR qui remplace l'empreinte dans le `deployment.yaml`.
3. Après relecture, le merge déclenche le déploiement par ArgoCD.

Tant que l'empreinte est nulle (`sha256:000…`, valeur de remplacement du premier commit), l'image ne démarre pas : c'est
volontaire. Les Applications concernées restent `Degraded` jusqu'à la première publication.

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
