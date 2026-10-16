# cosign et Trivy

**Couche** : Plateforme GitOps · **Où** : CI (signature, scan), Zot (scan CVE), Kyverno (vérification) · **Version** : cosign et trivy du devshell (`flake.lock`) ; Trivy DB via Zot

## À quoi elle sert ici et pourquoi ce choix

Chaîne d'approvisionnement : les images construites par la CI sont **scannées** (Trivy, bloquant) puis **poussées et signées** (cosign) ; un scan en échec empêche tout push et toute signature. Le registry [Zot](zot.md) scanne aussi les images stockées, et
[Kyverno](kyverno.md) vérifie les signatures : clé publique cosign pour les images de challenge du registry interne, signature **keyless** (identité du workflow `images.yml`) pour les images du projet (`ctfd`, `frontend`, `netbird-sync`). Trivy sert enfin à auditer les manifestes (`trivy config`) et à détecter des secrets dans l'arbre de travail.

## Où elle tourne et comment elle est déployée

- CI : `scripts/build-image.sh`, dans cet ordre : build, **scan** `trivy image --severity HIGH,CRITICAL --ignore-unfixed` (bloquant, avant tout push), push, signature `cosign sign` du digest (`COSIGN_KEY` ou keyless OIDC), avec SBOM et provenance `mode=max`. Le digest est affiché dans le résumé du job `images`.
- Cluster : politiques Kyverno `verify-images` (Enforce) et `verify-images-audit` (Audit), l'une ou l'autre active selon `pad-image-policy.mode` ; `restrict-instance-images` impose en plus le registre interne et l'empreinte aux pods d'instance ; Zot embarque Trivy (extension `cve`).

## Version épinglée

`cosign`, `trivy`, `syft` : paquets du `flake.nix` figés par `flake.lock`. Clé publique de vérification : clé `cosign.pub` du ConfigMap `kyverno/pad-image-policy` (`gitops/platform/kyverno/policies/image-policy-configmap.yaml`), `CHANGEME` tant que l'opérateur n'a pas généré la sienne.

## Fichiers de configuration dans le dépôt

- `scripts/build-image.sh`, `apps/Taskfile.yml` (`apps:push`, `apps:sign`).
- `.github/workflows/images.yml` (build, signature, scan) et `ci.yml` (job `security` : `trivy config`, `trivy fs --scanners secret`).
- `gitops/platform/kyverno/policies/verify-images.yaml`, `restrict-instance-images.yaml`, `image-policy-configmap.yaml`, `gitops/platform/zot/values.yaml` (extension `cve`).

## Interactions avec les autres briques

Produit des signatures consommées par [Kyverno](kyverno.md) et stockées dans [Zot](zot.md) ; exécuté par [GitHub Actions](github-actions.md).

## Sécurité

La vérification en cluster est en **Audit** par défaut (`mode: audit`) et passe en **Enforce** par un commit de l'opérateur, une fois la clé publique posée et les images signées : [Images signées](../operations/images-signees.md). Le scan CI échoue sur une vulnérabilité HIGH/CRITICAL corrigeable.

## Supervision

Violations de politique : `KyvernoPolicyViolations` ([Kyverno](../runbooks/kyverno.md)). Résultats de scan : sortie de la CI et UI de Zot.

## Opérations courantes

```bash
task apps:build                         # construit les images présentes
task apps:sign                          # construit, pousse et signe (PUSH=1 SIGN=1)
cosign verify --key cosign.pub <image>@sha256:<digest>
trivy image --severity HIGH,CRITICAL --ignore-unfixed <image>@sha256:<digest>
```

## Pièges connus

- Signer le **digest**, pas le tag : le script le fait à partir des métadonnées de build.
- Les images de challenges doivent aussi être signées (clé privée dans la CI du dépôt de challenges) pour passer `verify-images` en `enforce`.
- Tant que les digests des manifests `ctfd`, `frontend` et `netbird-sync` valent `sha256:000…`, les pods ne démarrent pas : première publication de la CI, puis PR Renovate ([Actions manuelles](../operations/actions-post-deploiement.md)).

## Documentation officielle

[docs.sigstore.dev](https://docs.sigstore.dev/) · [trivy.dev](https://trivy.dev/)

[Retour à l'index des composants](index.md){ .md-button }
