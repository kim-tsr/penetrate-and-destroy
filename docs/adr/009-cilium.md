# ADR 9 : CNI : Cilium

**Statut** : acceptée.

## Contexte

Les instances de challenges de plusieurs équipes cohabitent sur les mêmes nœuds et doivent être isolées entre elles. Chaque instance doit aussi avoir sa propre IP routable depuis le VPN.

## Décision

**Cilium** remplace kube-proxy, fournit les NetworkPolicy (L3/L4 et L7), le chiffrement WireGuard entre nœuds, Hubble pour l'observabilité des flux, et **LB-IPAM** : deux pools d'adresses (`ingress`, `instances`) sélectionnés par le label `pad.io/lb-pool` des Services.

## Alternatives écartées

- **Calico** : bon, mais pas d'équivalent LB-IPAM intégré ni d'observabilité aussi fine.
- **Flannel** : pas de NetworkPolicy.
- **MetalLB en plus d'un CNI simple** : une pièce supplémentaire pour un besoin couvert par Cilium.

## Conséquences

- Le cluster s'étend sur deux zones (PROD et CHALLENGES) : la règle I3 de la [matrice de flux](../architecture/flux.md) autorise VXLAN, WireGuard et les ports de santé entre nœuds.
- Cilium doit être installé avant que les nœuds soient Ready : c'est une étape du bootstrap.
