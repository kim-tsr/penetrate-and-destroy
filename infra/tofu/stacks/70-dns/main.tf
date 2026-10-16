# Stack 70 : enregistrements A publics (front, auth, vpn, status) vers l'IP WAN de la plateforme.
# Les hostnames internes (bastion, grafana, argocd...) ne sont jamais publiés.

locals {
  # IP WAN : IP publique de la plateforme (secrets/site.sops.yaml) ; en mode nat, celle de l'hôte (DNAT nftables).
  wan_ip = local.site.wan.ip

  public_hosts = {
    for k in local.c.public_hostnames : k => local.c.hostnames[k]
  }

  # Sous-domaine possible : domain = lab.mondomaine.fr dans la zone dns_zone = mondomaine.fr -> enregistrements "ctf.lab", etc.
  dns_zone = try(local.c.dns_zone, "") != "" ? local.c.dns_zone : local.c.domain
  suffix   = local.dns_zone == local.c.domain ? "" : ".${trimsuffix(local.c.domain, ".${local.dns_zone}")}"
}

check "domaine_dans_la_zone" {
  assert {
    condition     = local.dns_zone == local.c.domain || endswith(local.c.domain, ".${local.dns_zone}")
    error_message = "domain doit être dns_zone ou l'un de ses sous-domaines."
  }
}

resource "ovh_domain_zone_record" "public" {
  for_each = local.public_hosts

  zone      = local.dns_zone
  subdomain = "${each.value}${local.suffix}"
  fieldtype = "A"
  ttl       = var.record_ttl
  target    = local.wan_ip
}
