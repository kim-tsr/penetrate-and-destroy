# Valkey

**Couche** : Plateforme GitOps · **Où** : pod du cluster (namespace `storage`, StatefulSet) · **Version** : chart 0.12.0, image 9.1.2

## À quoi elle sert ici et pourquoi ce choix

CTFd s'en sert comme cache et le front comme magasin partagé entre replicas (jeton CTFd par identité, verrou de renouvellement, limitation de débit). Valkey est un fork libre
et compatible de Redis. Décision : [ADR 11](../adr/011-bases-de-donnees.md).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/valkey` (vague -2), un seul nœud sans réplica, persistance AOF sur 2 Gi `pad-zfs`, stratégie `Recreate`.

## Version épinglée

Chart `valkey` 0.12.0 dans `gitops/platform/valkey/application.yaml` ; image `valkey/valkey:9.1.2@sha256:...` et exporter `redis_exporter:v1.79.0@sha256:...` dans `values.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/valkey/values.yaml` (`maxmemory 192mb`, `noeviction`, `appendonly yes`, ACL par mot de passe).
- `secret.example.yaml` et `secret-generator.yaml` (mot de passe partagé avec CTFd et le front).

## Interactions avec les autres briques

Utilisé par [CTFd](ctfd.md) (`REDIS_HOST`) et le [front](frontend.md) (`VALKEY_URL`) ; volume via [Proxmox CSI](proxmox-csi.md).

## Sécurité

Authentification obligatoire (ACL) ; namespace `storage` en `CiliumNetworkPolicy` default-deny (`gitops/platform/namespaces/resources/storage.yaml`), avec autorisations explicites en entrée et en sortie.

## Supervision

Exporter Prometheus (`metrics.enabled`) ; la perte de Valkey n'arrête pas le front (échec ouvert, voir [API des plugins](../reference/api-plugins.md)).

## Opérations courantes

```bash
kubectl -n storage get pods
kubectl -n storage exec -it valkey-0 -- valkey-cli --user default -a "$PASSWORD" info memory   # mot de passe via sops
```

## Pièges connus

`noeviction` avec 192 Mo : une saturation mémoire fait échouer les écritures plutôt que d'éjecter des clés ; surveiller la mémoire.

## Documentation officielle

[valkey.io](https://valkey.io/documentation/)

[Retour à l'index des composants](index.md){ .md-button }
