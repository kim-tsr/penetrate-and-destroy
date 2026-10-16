# external-dns (OVH) : désactivé par défaut

Le chart est déployé avec `replicaCount: 0` : aucun pod, aucun appel à l'API OVH, zéro RAM consommée.
Les enregistrements publics sont gérés ailleurs (OpenTofu). Le composant est prêt si l'on veut des DNS dynamiques.

## Activation

1. Créer l'application OVH et son consumer key (droits GET/POST/PUT/DELETE sur `/domain/zone/<domain>/*`), puis
   renseigner les valeurs dans le Secret chiffré créé par `task secrets:init` :
   ```bash
   sops gitops/platform/external-dns/secret.sops.yaml
   ```
   Le générateur ksops (`secret-generator.yaml`) est déjà référencé par `kustomization.yaml` (docs/SECRETS.md).
2. Dans `values.yaml` : `replicaCount: 1`, `domainFilters` = domaine réel (`domain` du contrat), `OVH_ENDPOINT` = `acme.ovh_endpoint`.
3. Le namespace `external-dns` (et sa NetworkPolicy Cilium) existe déjà ; autoriser l'egress vers `eu.api.ovh.com:443`
   dans la NetworkPolicy si l'on active le composant.
