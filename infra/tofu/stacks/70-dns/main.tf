# Stack 70 : enregistrements A publics (front, auth, vpn, status) vers l'IP WAN de la plateforme.
# Les hostnames internes (bastion, grafana, argocd...) ne sont jamais publiés.

locals {
  # IP WAN : IP publique de la plateforme (secrets/site.sops.yaml) ; en mode nat, celle de l'hôte (DNAT nftables).
  wan_ip = local.site.wan.ip

  public_hosts = {
    for k in local.c.public_hostnames : k => local.c.hostnames[k]
  }
}

resource "ovh_domain_zone_record" "public" {
  for_each = local.public_hosts

  zone      = local.c.domain
  subdomain = each.value
  fieldtype = "A"
  ttl       = var.record_ttl
  target    = local.wan_ip
}
