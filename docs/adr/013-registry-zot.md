# ADR 13 : Registry d'images : Zot

**Statut** : acceptée.

## Contexte

Les images de challenges et de la plateforme doivent être hébergées en interne, scannées et vérifiables.

## Décision

**Zot**, registry OCI interne (`registry.pad.internal`), avec scan Trivy. La CI signe les images avec **cosign** ; la politique Kyverno `verifyImages` vérifie la signature à l'admission.

## Alternatives écartées

- **Harbor** : complet mais lourd pour cet hôte.
- **Docker Registry** : pas de scan ni d'UI.
- **Registry publique** : fuite des sources des challenges avant l'événement.

## Conséquences

- La politique `verify-images` démarre en mode **Audit** : la passer en Enforce une fois la clé publique renseignée et les images signées (voir [Kyverno](../runbooks/kyverno.md)).
- Les images de la plateforme sont épinglées par digest.
