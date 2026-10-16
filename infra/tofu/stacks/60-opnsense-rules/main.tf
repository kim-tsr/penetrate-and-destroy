# Stack 60 : matrice de flux OPNsense (docs/PLAN.md, section Réseau).
#
# Principe : règles "automation" (MVC) évaluées en premier, `quick`, direction `in` sur l'interface de la zone source.
# Tout ce qui n'est pas explicitement autorisé tombe sur la règle finale BLOCK journalisée (deny par défaut).
# Le trafic intra-zone (même VLAN) ne traverse pas OPNsense : il est filtré par Cilium/NetBird si besoin.
#
# Correspondance matrice -> règles (préfixe "M" = matrice du PLAN, "I" = infrastructure, variables allow_*/internet_*) :
#   M1  Internet -> DMZ : 443/80 (edge) et ports NetBird (netbird), + port-forwards WAN
#   M2  DMZ (edge) -> PROD : ingress (Traefik du cluster, ingress_ip) en 80/443
#   M3  DMZ (edge) -> IDENTITY : 443 (authentik)
#   M4  Joueurs NetBird -> CHALLENGES : via le routing peer situé DANS la zone challenges => intra-zone, pas de règle OPNsense
#       (filtrage par policies NetBird + CiliumNetworkPolicy, contrôleur netbird-sync en phase 2)
#   M5  Staff NetBird -> BASTION uniquement : peer de routage staff = LXC netbird (DMZ) -> warpgate (ports Warpgate)
#   M6  BASTION -> toutes zones : SSH, HTTPS, kube API 6443, Talos API 50000 (+ OPNsense lui-même : SSH/GUI)
#   M7  Toutes zones -> MONITORING : push uniquement
#   M8  MONITORING -> toutes zones : scrape uniquement
#   M9  PROD -> API Proxmox (CAPMOX, CSI)
#   M10 CHALLENGES -> API kube + DNS interne ; egress Internet uniquement vers l'allowlist
#   I*  DNS des zones, egress Internet, OIDC back-channel, inter-nœuds Kubernetes, status page

locals {
  zones = local.c.zones
  p     = local.c.flow_ports
  svc   = local.c.services
  k8s   = local.c.kubernetes

  # Même dérivation que le module opnsense-vm : zones triées par VLAN, la 1re = lan, puis opt1..optN.
  zone_names        = [for z in sort([for name, z in local.zones : format("%04d-%s", z.vlan, name)]) : split("-", z)[1]]
  iface             = { for idx, name in local.zone_names : name => idx == 0 ? "lan" : "opt${idx}" }
  all_zone_ifaces   = [for name in local.zone_names : local.iface[name]]
  ifaces_except_mon = [for name in local.zone_names : local.iface[name] if name != "monitoring"]

  # Format des plages : "a-b" (contrat) -> "a:b" (alias de ports OPNsense).
  port_list = { for k, v in local.p : k => [for x in flatten([v]) : replace(tostring(x), "-", ":")] if !can(keys(v)) }
  ip_range  = { for k, r in { cp = local.k8s.control_plane.ip_pool, platform = local.k8s.pools.platform.ip_pool, challenges = local.k8s.pools.challenges.ip_pool } : k => "${r[0]}-${r[1]}" }
}

# --- Aliases --------------------------------------------------------------------------------------

locals {
  aliases = merge(
    # Réseaux par zone
    { for name, z in local.zones : "net_${name}" => { type = "network", content = [z.cidr], description = "Zone ${name} (VLAN ${z.vlan})" } },
    {
      net_all_zones = { type = "network", content = [for z in local.zones : z.cidr], description = "Toutes les zones internes" }
      net_private   = { type = "network", content = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"], description = "Plages privées/CGNAT (exclues de l'egress Internet)" }

      # Hôtes de services (contrat)
      host_edge         = { type = "host", content = [local.svc.edge.ip], description = "LXC edge (Traefik + CrowdSec)" }
      host_netbird      = { type = "host", content = [local.svc.netbird.ip], description = "LXC netbird (management, signal, relay, coturn ; routing peer staff)" }
      host_warpgate     = { type = "host", content = [local.svc.warpgate.ip], description = "LXC warpgate (bastion)" }
      host_authentik    = { type = "host", content = [local.svc.authentik.ip], description = "LXC authentik (IdP)" }
      host_monitoring   = { type = "host", content = [local.svc.monitoring.ip], description = "LXC monitoring" }
      host_k8s_ingress  = { type = "host", content = [local.k8s.ingress_ip], description = "Traefik interne du cluster (LB Cilium)" }
      host_k8s_api      = { type = "host", content = [local.k8s.control_plane_endpoint], description = "VIP API Kubernetes (Talos)" }
      host_proxmox_api  = { type = "host", content = [local.c.host.mgmt_ip], description = "API Proxmox (hôte en zone mgmt)" }
      host_k8s_nodes    = { type = "host", content = values(local.ip_range), description = "Plages d'IP des nœuds Talos (cp, platform, challenges)" }
      host_chall_egress = { type = "host", content = var.challenges_egress_allowlist, description = "Allowlist egress Internet des challenges" }

      # Ports
      port_web          = { type = "port", content = [tostring(local.p.http), tostring(local.p.https)], description = "HTTP/HTTPS" }
      port_bastion      = { type = "port", content = [for x in [local.p.ssh, local.p.https, local.p.kube_api, local.p.talos_api] : tostring(x)], description = "Accès bastion : SSH, HTTPS, kube API, Talos API" }
      port_warpgate     = { type = "port", content = local.port_list.warpgate, description = "Warpgate (SSH, HTTPS)" }
      port_mon_push     = { type = "port", content = local.port_list.monitoring_push, description = "Push monitoring (remote_write, Loki, OTLP)" }
      port_mon_scrape   = { type = "port", content = local.port_list.monitoring_scrape, description = "Scrape monitoring (exporters, kubelet, Alloy)" }
      port_admin_self   = { type = "port", content = [tostring(local.p.ssh), tostring(local.p.https)], description = "Admin OPNsense (SSH, GUI)" }
      port_k8s_node_tcp = { type = "port", content = [for x in [local.p.kubelet, local.p.talos_api, local.p.talos_trustd, local.p.cilium.health_tcp, local.p.cilium.hubble_tcp] : tostring(x)], description = "Inter-nœuds TCP (kubelet, apid, trustd, Cilium health, Hubble)" }
      port_k8s_node_udp = { type = "port", content = [tostring(local.p.cilium.vxlan_udp), tostring(local.p.cilium.wireguard_udp)], description = "Inter-nœuds UDP (Cilium VXLAN, WireGuard)" }
      port_egress_tcp   = { type = "port", content = [tostring(local.p.http), tostring(local.p.https)], description = "Egress Internet TCP" }
    },
  )
}

resource "opnsense_firewall_alias" "this" {
  for_each = { for k, v in local.aliases : k => v if length(v.content) > 0 } # alias vide refusé par OPNsense (allowlist egress vide)

  name        = each.key
  type        = each.value.type
  content     = toset(each.value.content)
  description = "pad: ${each.value.description}"
  categories  = [opnsense_firewall_category.pad.id]
}

resource "opnsense_firewall_category" "pad" {
  name  = "pad"
  color = "c0392b"
}

# --- Règles de filtrage --------------------------------------------------------------------------

locals {
  # proto : "TCP", "UDP", "TCP/UDP" ou "any" ; src/dst : alias, "any" ou "(self)" ; port : alias de ports ou numéro.
  matrix_rules = [
    # M2/M3 - edge -> ingress du cluster, edge -> authentik
    { id = "m2-edge-ingress", seq = 200, ifaces = [local.iface["dmz"]], proto = "TCP", src = "host_edge", dst = "host_k8s_ingress", port = "port_web", desc = "M2 edge -> ingress PROD" },
    { id = "m3-edge-authentik", seq = 210, ifaces = [local.iface["dmz"]], proto = "TCP", src = "host_edge", dst = "host_authentik", port = tostring(local.p.https), desc = "M3 edge -> authentik 443" },

    # M5 - staff NetBird (routing peer = LXC netbird) -> bastion uniquement
    { id = "m5-netbird-warpgate", seq = 300, ifaces = [local.iface["dmz"]], proto = "TCP", src = "host_netbird", dst = "host_warpgate", port = "port_warpgate", desc = "M5 staff NetBird -> warpgate" },

    # M6 - bastion -> toutes zones (SSH, HTTPS, 6443, 50000) et administration d'OPNsense
    { id = "m6-bastion-zones", seq = 400, ifaces = [local.iface["bastion"]], proto = "TCP", src = "net_bastion", dst = "net_all_zones", port = "port_bastion", desc = "M6 bastion -> zones SSH/HTTPS/6443/50000" },
    { id = "m6-bastion-self", seq = 410, ifaces = [local.iface["bastion"]], proto = "TCP", src = "net_bastion", dst = "(self)", port = "port_admin_self", desc = "M6 bastion -> OPNsense SSH/GUI" },

    # M7/M8 - monitoring
    { id = "m7-zones-push", seq = 500, ifaces = local.ifaces_except_mon, proto = "TCP", src = "net_all_zones", dst = "host_monitoring", port = "port_mon_push", desc = "M7 zones -> monitoring (push)" },
    { id = "m8-monitoring-scrape", seq = 510, ifaces = [local.iface["monitoring"]], proto = "TCP", src = "net_monitoring", dst = "net_all_zones", port = "port_mon_scrape", desc = "M8 monitoring -> zones (scrape)" },

    # M9 - PROD -> API Proxmox (CAPMOX, Proxmox CSI)
    { id = "m9-prod-proxmox", seq = 600, ifaces = [local.iface["prod"]], proto = "TCP", src = "net_prod", dst = "host_proxmox_api", port = tostring(local.p.proxmox_api), desc = "M9 PROD -> API Proxmox" },

    # M10 - CHALLENGES : API kube + DNS interne + allowlist Internet, rien d'autre
    { id = "m10-chall-kubeapi", seq = 700, ifaces = [local.iface["challenges"]], proto = "TCP", src = "net_challenges", dst = "host_k8s_api", port = tostring(local.p.kube_api), desc = "M10 CHALLENGES -> API kube" },
    { id = "m10-chall-dns", seq = 710, ifaces = [local.iface["challenges"]], proto = "TCP/UDP", src = "net_challenges", dst = "(self)", port = tostring(local.p.dns), desc = "M10 CHALLENGES -> DNS interne (Unbound)" },
  ]

  # M1 - Internet -> DMZ : une règle par entrée de wan.public_ports (après port-forward, la destination est l'IP interne).
  wan_rules = [
    for i, e in local.c.wan.public_ports : {
      id  = "m1-wan-${e.to}-${e.proto}-${replace(tostring(e.port), "-", "_")}", seq = 100 + i, ifaces = ["wan"], proto = upper(e.proto),
      src = "any", dst = "host_${e.to}", port = tostring(e.port), desc = "M1 Internet -> ${e.to} ${e.proto}/${e.port}"
    }
  ]

  chall_egress_rules = length(var.challenges_egress_allowlist) == 0 ? [] : [
    { id = "m10-chall-egress", seq = 720, ifaces = [local.iface["challenges"]], proto = "TCP", src = "net_challenges", dst = "host_chall_egress", port = "port_egress_tcp", desc = "M10 CHALLENGES -> allowlist Internet" },
  ]

  infra_rules = concat(
    !var.allow_dns_all_zones ? [] : [
      { id = "i1-zones-dns", seq = 800, ifaces = local.all_zone_ifaces, proto = "TCP/UDP", src = "net_all_zones", dst = "(self)", port = tostring(local.p.dns), desc = "I1 zones -> DNS Unbound" },
    ],
    !var.allow_oidc_all_zones ? [] : [
      { id = "i2-zones-oidc", seq = 810, ifaces = local.all_zone_ifaces, proto = "TCP", src = "net_all_zones", dst = "host_authentik", port = tostring(local.p.https), desc = "I2 zones -> authentik 443 (OIDC back-channel)" },
    ],
    !var.allow_kube_cross_zone ? [] : [
      { id = "i3-k8s-nodes-tcp", seq = 820, ifaces = [local.iface["prod"], local.iface["challenges"]], proto = "TCP", src = "host_k8s_nodes", dst = "host_k8s_nodes", port = "port_k8s_node_tcp", desc = "I3 nœuds k8s inter-zones TCP" },
      { id = "i3-k8s-nodes-udp", seq = 821, ifaces = [local.iface["prod"], local.iface["challenges"]], proto = "UDP", src = "host_k8s_nodes", dst = "host_k8s_nodes", port = "port_k8s_node_udp", desc = "I3 nœuds k8s inter-zones UDP (Cilium)" },
    ],
    !var.allow_edge_status_page ? [] : [
      { id = "i4-edge-status", seq = 830, ifaces = [local.iface["dmz"]], proto = "TCP", src = "host_edge", dst = "host_monitoring", port = tostring(local.p.uptime_kuma), desc = "I4 edge -> status page Uptime Kuma" },
    ],
    length(var.internet_egress_zones) == 0 ? [] : [
      { id = "i5-egress-tcp", seq = 900, ifaces = [for z in var.internet_egress_zones : local.iface[z]], proto = "TCP", src = "net_all_zones", dst = "!net_private", port = "port_egress_tcp", desc = "I5 zones -> Internet 80/443" },
      { id = "i5-egress-ntp", seq = 901, ifaces = [for z in var.internet_egress_zones : local.iface[z]], proto = "UDP", src = "net_all_zones", dst = "!net_private", port = tostring(local.p.ntp), desc = "I5 zones -> Internet NTP" },
    ],
  )

  pass_rules = { for r in concat(local.wan_rules, local.matrix_rules, local.chall_egress_rules, local.infra_rules) : r.id => r }
}

resource "opnsense_firewall_filter" "pass" {
  for_each = local.pass_rules

  enabled     = true
  sequence    = each.value.seq
  description = "pad ${each.value.desc}"
  categories  = [opnsense_firewall_category.pad.id]

  interface = {
    interface = toset(each.value.ifaces)
  }

  filter = {
    action      = "pass"
    direction   = "in"
    quick       = true
    ip_protocol = "inet"
    protocol    = each.value.proto
    log         = false

    source = {
      net = each.value.src
    }

    destination = {
      net    = trimprefix(each.value.dst, "!")
      invert = startswith(each.value.dst, "!")
      port   = each.value.port
    }
  }

  depends_on = [opnsense_firewall_alias.this]
}

# Deny par défaut, journalisé, en toute fin (après toutes les règles pad).
resource "opnsense_firewall_filter" "default_deny" {
  enabled     = true
  sequence    = 60000
  description = "pad DENY par défaut (journalisé)"
  categories  = [opnsense_firewall_category.pad.id]

  interface = {
    interface = toset(concat(["wan"], local.all_zone_ifaces))
  }

  filter = {
    action      = "block"
    direction   = "in"
    quick       = true
    ip_protocol = "inet"
    protocol    = "any"
    log         = true

    source = {
      net = "any"
    }

    destination = {
      net = "any"
    }
  }

  depends_on = [opnsense_firewall_filter.pass]
}

# --- Port-forwards WAN (contrat wan.public_ports) ----------------------------------------------
# Destination : adresse WAN d'OPNsense (IP publique routée vers la VM, ou transit .2 en mode nat après DNAT de l'hôte).
# NAT sortant : mode "automatic" posé par config.xml (stack 10) => chaque réseau de zone est NATé derrière l'adresse WAN.
# Les règles opnsense_firewall_nat (outbound) ne s'appliquent qu'en mode hybrid/manual : non utilisées ici.

resource "opnsense_firewall_nat_port_forward" "wan" {
  for_each = { for e in local.c.wan.public_ports : "${e.proto}-${replace(tostring(e.port), "-", ":")}" => e }

  enabled        = true
  sequence       = 100 + index(local.c.wan.public_ports, each.value)
  description    = "pad WAN ${upper(each.value.proto)} ${each.value.port} -> ${each.value.to}"
  interface      = ["wan"]
  ip_protocol    = "inet"
  protocol       = upper(each.value.proto)
  nat_reflection = "disable"
  log            = false

  source = {
    net = "any"
  }

  destination = {
    net  = "wanip"
    port = tostring(each.value.port)
  }

  target = {
    ip   = local.svc[each.value.to].ip
    port = split("-", tostring(each.value.port))[0] # plage : décalage conservé par pf
  }
}
