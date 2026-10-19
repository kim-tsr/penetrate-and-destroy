# Traefik (cluster)

**Couche** : Cluster Kubernetes · **Où** : pods Traefik (2 replicas, pool platform), IP 10.20.60.200 · **Version** : chart 42.0.0

## À quoi elle sert ici et pourquoi ce choix

Reçoit le trafic déjà filtré par l'[edge](traefik-edge.md) (HTTP) et le dirige vers le front, CTFd et les interfaces internes (ArgoCD, Hubble, registry...). Il porte aussi
des middlewares partagés (en-têtes de sécurité, limite de débit, limite de requêtes simultanées).

## Où elle tourne et comment elle est déployée

Application ArgoCD `gitops/platform/traefik` (chart, sync-wave -3), 2 replicas avec PodDisruptionBudget, `Service LoadBalancer` à l'IP fixe `10.20.60.200` (pool `ingress` de Cilium), `externalTrafficPolicy: Local`.

## Version épinglée

Chart `traefik` 42.0.0 dans `gitops/platform/traefik/application.yaml`.

## Fichiers de configuration dans le dépôt

- `gitops/platform/traefik/values.yaml` (providers CRD et Ingress, entrypoints, `forwardedHeaders.trustedIPs` = IP de l'edge uniquement).
- `gitops/platform/traefik/resources/middlewares.yaml` : `security-headers`, `rate-limit`, `in-flight`.
- Ingress applicatifs : `gitops/apps/ctfd/ingress.yaml`, `gitops/apps/frontend/ingress.yaml`.

## Interactions avec les autres briques

Reçoit de l'[edge](traefik-edge.md) ; certificats par [cert-manager](cert-manager.md) ; IP par [Cilium](cilium-hubble.md) ; métriques lues par [Alloy](alloy.md).

## Sécurité

Seul l'edge est un proxy de confiance pour les en-têtes `X-Forwarded-*` ; pas de dashboard Traefik exposé ; Services `ExternalName` interdits.

CiliumNetworkPolicy `traefik` (`gitops/platform/namespaces/resources/traefik.yaml`) : entrée sur les entrypoints (8000, 8443) depuis `world` (l'edge, règle M2 ; les nœuds challenges avant que Cilium y tourne, règle M10) et depuis les nœuds du cluster (`remote-node`, `host` : containerd des nœuds challenges qui tire par le [miroir Zot](zot.md#miroir-pull-through-zone-challenges)) ; sortie vers les pods du cluster, chaque backend filtrant son entrée. Le filtrage des sources inter-zones est fait par OPNsense.

## Supervision

Métriques de l'entrypoint ; alertes `IngressHigh5xxRatio`, `IngressHighLatency` : [Ingress](../runbooks/ingress.md). Dashboard `pad-platform`.

## Opérations courantes

```bash
kubectl -n traefik get pods,svc
kubectl get ingress -A
```

## Pièges connus

- Le `Service` n'est annoncé en L2 que depuis les nœuds portant un pod Traefik (`externalTrafficPolicy: Local`) : les 2 replicas doivent être répartis.
- Les `Middleware` sont des CRD installées par le chart : `SkipDryRunOnMissingResource` est nécessaire dans l'Application.
- Le front est routé sur l'entrypoint `web` (HTTP), sans redirection vers `websecure` : l'edge y arrive en HTTP après avoir
  terminé le TLS. Avec la redirection et un routeur `websecure` seul, l'edge recevait un 418 (front injoignable) ; en HTTPS,
  aucun certificat du cluster ne couvre le nom public (`sniStrict` : « unrecognized name »). Les noms internes (ArgoCD,
  registry) restent sur `websecure` avec leurs certificats cert-manager.

## Documentation officielle

[doc.traefik.io](https://doc.traefik.io/traefik/)

[Retour à l'index des composants](index.md){ .md-button }
