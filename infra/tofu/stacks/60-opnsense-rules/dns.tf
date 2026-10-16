# Split-DNS : les zones internes résolvent les noms publics servis par l'edge (contrat `public_hostnames`) vers l'IP INTERNE de l'edge.
# Sans cela, les LXC (netbird, warpgate, monitoring...) et le cluster obtiendraient l'IP publique, que rien ne garantit joignable
# depuis l'intérieur (pas de réflexion NAT : nat_reflection = "disable"). Tous les LXC et nœuds Kubernetes utilisent le .1 de leur
# zone (Unbound d'OPNsense) comme résolveur : LXC par stack 20 (initialization.dns), nœuds par les manifests CAPI (dnsServers).
# Flux associé : règle I2 (toutes zones -> edge:443), puis edge -> authentik (M3) / ingress (M2).

resource "opnsense_unbound_host_override" "public" {
  for_each = toset(local.c.public_hostnames)

  enabled     = true
  hostname    = local.c.hostnames[each.value]
  domain      = local.c.domain
  type        = "A"
  server      = local.svc.edge.ip
  description = "pad split-DNS: ${each.value} -> edge (IP interne)"
}

# Nom interne du registre Zot (contrat apps.registry = hostnames.registry + internal_domain) -> ingress du cluster
# (Traefik, kubernetes.ingress_ip). Sans cet override, registry.pad.internal ne résout nulle part (NXDOMAIN) : ni les
# nœuds de la zone CHALLENGES (miroir pull-through de leurs images, règle M10 m10-chall-registry), ni les pods
# (chall-manager), ni le poste staff ne joignent Zot.
resource "opnsense_unbound_host_override" "registry" {
  enabled     = true
  hostname    = local.c.hostnames.registry
  domain      = local.c.internal_domain
  type        = "A"
  server      = local.k8s.ingress_ip
  description = "pad registre Zot (${local.c.apps.registry}) -> ingress du cluster"
}
