# Zot (registry OCI)

**Couche** : Plateforme GitOps · **Où** : pod du cluster (namespace `registry`), `registry.pad.internal` · **Version** : chart 0.1.128, image v2.1.22

## À quoi elle sert ici et pourquoi ce choix

Héberge les images des challenges instanciés, le scénario OCI de chall-manager et les artefacts internes, avec **recherche et scan CVE (Trivy)** intégrés et métriques.
Un registry interne évite de dépendre d'un registry public pour des images de challenges. Décision : [ADR 13](../adr/013-registry-zot.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/zot` (vague -2), un réplica, volume 30 Gi `pad-zfs`, Ingress Traefik sur `registry.pad.internal` (nom interne, jamais publié), GC toutes les 6 h.

## Version épinglée

Chart `zot` 0.1.128 dans `gitops/platform/zot/application.yaml` ; image `ghcr.io/project-zot/zot:v2.1.22@sha256:...` dans `values.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/zot/values.yaml` (configuration JSON : stockage, auth htpasswd, contrôle d'accès, extensions `search`/`cve`/`metrics`).
- `resources/podmonitor.yaml`, `secret.example.yaml` (htpasswd), `secret-metrics.example.yaml`.

## Interactions avec les autres briques

Alimenté par la [CI](github-actions.md) (`pad-ci`) ; lu par [chall-manager](chall-manager.md) et le cluster (`pad-pull`) ; images contrôlées par [Kyverno](kyverno.md) ([cosign et Trivy](cosign-trivy.md)).

## Sécurité

- Authentification htpasswd obligatoire (hash bcrypt, mots de passe en clair dans `secrets/credentials.sops.yaml`).
- Contrôle d'accès : `pad/**` réservé à `pad-ci` (écriture) et `pad-pull` (lecture) ; `public/**` en lecture anonyme ; métriques pour l'utilisateur `metrics`.
- Interface interne uniquement.

## Supervision

PodMonitor Zot ; panne : [Charges Kubernetes](../runbooks/kubernetes-workloads.md).

## Opérations courantes

```bash
sops -d --extract '["zot_pad_ci_password"]' secrets/credentials.sops.yaml
docker login registry.pad.internal -u pad-ci
cosign sign registry.pad.internal/pad/<image>@sha256:<digest>
```

## Pièges connus

- Le registry n'est joignable que depuis un poste staff NetBird ou la CI : pas depuis Internet.
- Un seul réplica sur un PVC : à sauvegarder si les images ne sont pas reconstructibles.

## Documentation officielle

[zotregistry.dev](https://zotregistry.dev/)

[Retour à l'index des composants](index.md){ .md-button }
