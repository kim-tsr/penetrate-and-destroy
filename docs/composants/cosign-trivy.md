# cosign et Trivy

**Couche** : Plateforme GitOps · **Où** : CI (signature, scan), Zot (scan CVE), Kyverno (vérification) · **Version** : cosign et trivy du devshell (`flake.lock`) ; Trivy DB via Zot

## À quoi elle sert ici et pourquoi ce choix

Chaîne d'approvisionnement : les images construites par la CI sont **signées** (cosign) et **scannées** (Trivy). Le registry [Zot](zot.md) scanne aussi les images stockées, et
[Kyverno](kyverno.md) vérifie les signatures des images du registry interne. Trivy sert enfin à auditer les manifestes (`trivy config`) et à détecter des secrets dans l'arbre de travail.

## Où elle tourne et comment elle est déployée

- CI : `scripts/build-image.sh` (SBOM, provenance `mode=max`, signature `cosign sign`, clé `COSIGN_KEY` ou keyless OIDC) ; job `images` puis `trivy image --severity HIGH,CRITICAL --ignore-unfixed`.
- Cluster : politique Kyverno `verify-images` ; Zot embarque Trivy (extension `cve`).

## Version épinglée

`cosign`, `trivy`, `syft` : paquets du `flake.nix` figés par `flake.lock`. Clé publique de vérification : `gitops/platform/kyverno/policies/cosign-pubkey-configmap.yaml`.

## Fichiers de configuration dans le dépôt

- `scripts/build-image.sh`, `apps/Taskfile.yml` (`apps:push`, `apps:sign`).
- `.github/workflows/images.yml` (build, signature, scan) et `ci.yml` (job `security` : `trivy config`, `trivy fs --scanners secret`).
- `gitops/platform/kyverno/policies/verify-images.yaml`, `gitops/platform/zot/values.yaml` (extension `cve`).

## Interactions avec les autres briques

Produit des signatures consommées par [Kyverno](kyverno.md) et stockées dans [Zot](zot.md) ; exécuté par [GitHub Actions](github-actions.md).

## Sécurité

La vérification en cluster est en **Audit** (voir [Kyverno](kyverno.md)) ; le scan CI échoue sur une vulnérabilité HIGH/CRITICAL corrigeable.

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
- Les images de challenges doivent aussi être signées pour passer la politique `verify-images`.

## Documentation officielle

[docs.sigstore.dev](https://docs.sigstore.dev/) · [trivy.dev](https://trivy.dev/)

[Retour à l'index des composants](index.md){ .md-button }
