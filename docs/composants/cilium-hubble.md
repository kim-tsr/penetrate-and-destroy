# Cilium et Hubble

**Couche** : Cluster Kubernetes · **Où** : DaemonSet sur tous les nœuds + operator, Hubble relay et UI · **Version** : chart 1.20.3

## À quoi elle sert ici et pourquoi ce choix

Cilium fournit le réseau des pods en eBPF, remplace kube-proxy, attribue les IP des Services `LoadBalancer` (LB-IPAM) et les annonce en L2, et chiffre le trafic entre nœuds
(WireGuard). **Hubble** donne la visibilité des flux (DNS, drops, TCP) pour le diagnostic réseau. Décision : [ADR 9](../adr/009-cilium.md).

## Où elle tourne et comment elle est déployée

Installé une première fois par `bootstrap/scripts/cluster.sh` (Helm, mêmes valeurs que l'Application), puis géré par ArgoCD (`gitops/platform/cilium`, sync-wave -9). Mode `tunnel` VXLAN (UDP 8472), IPAM `kubernetes`.

## Version épinglée

Chart `cilium` 1.20.3 dans `gitops/platform/cilium/application.yaml` (la version utilisée au bootstrap est lue dans cette Application).

## Fichiers de configuration dans le dépôt

- `gitops/platform/cilium/values.yaml` : `kubeProxyReplacement: true`, WireGuard, `l2announcements`, Hubble (relay, UI, métriques `dns, drop, tcp, flow, icmp`).
- `gitops/platform/cilium/resources/lb-ipam.yaml` : `CiliumLoadBalancerIPPool` `ingress` (`10.20.60.200-220`) et `instances` (`10.20.70.100-199`), sélection par le label `pad.io/lb-pool`, et la politique d'annonce L2.

## Interactions avec les autres briques

- Donne leur IP aux Services : l'ingress [Traefik](traefik-cluster.md) (`10.20.60.200`) et chaque instance de challenge (pool `instances`, annoncée par le [scénario](chall-manager-scenario.md)).
- Appliqué avec [Talos](talos.md) (KubePrism, `cni: none`).
- Les `NetworkPolicy` d'isolement des instances et des namespaces sont appliquées par Cilium ; [Kyverno](kyverno.md) génère des `default-deny`.

## Sécurité

- Chiffrement WireGuard des flux inter-nœuds (UDP 51871).
- `NetworkPolicy` default-deny dans chaque namespace applicatif et par instance.
- Capacités de l'agent restreintes à la liste nécessaire ; Hubble avec TLS automatique (cronJob).
- UI Hubble exposée en interne (`hubble.<domaine>`) derrière le forward-auth Authentik.

## Supervision

Métriques d'agent (9962) et Hubble (9965) via ServiceMonitors ; alertes de charge : [Charges Kubernetes](../runbooks/kubernetes-workloads.md). Pas de runbook dédié.

## Opérations courantes

```bash
cilium status --wait
hubble observe --namespace ctfd --last 50     # via le relay (port-forward)
kubectl get ciliumloadbalancerippools
```

## Pièges connus

- `hubble.tls.auto.method: cronJob` : le mode `helm` régénérerait les certificats à chaque rendu et laisserait ArgoCD en `OutOfSync` permanent.
- Cilium choisit le pool d'IP par `serviceSelector` (label), pas par annotation : un Service sans le label `pad.io/lb-pool` n'a pas d'IP.
- Le trafic intra-zone ne passe pas par OPNsense : c'est Cilium qui l'isole.

## Documentation officielle

[docs.cilium.io](https://docs.cilium.io/)

[Retour à l'index des composants](index.md){ .md-button }
