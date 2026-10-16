# Stack 10 : VM OPNsense, bootstrapée par un ISO contenant /conf/config.xml (voir infra/opnsense/README.md).

locals {
  wan_routed   = local.c.wan.mode == "routed_ip"
  transit_mask = split("/", local.c.wan.transit_cidr)[1]

  wan = local.wan_routed ? {
    mode         = "routed_ip"
    bridge       = local.c.host.wan_bridge
    mac_address  = try(local.site.wan.mac, "") != "" ? local.site.wan.mac : null # MAC dédiée si l'hébergeur l'exige
    address_cidr = "${local.site.wan.ip}/32"
    gateway      = local.site.wan.gateway # passerelle de l'hôte, hors sous-réseau (/32)
    far_gateway  = true
    } : {
    mode         = "nat"
    bridge       = local.c.host.transit_bridge
    mac_address  = null
    address_cidr = "${cidrhost(local.c.wan.transit_cidr, 2)}/${local.transit_mask}"
    gateway      = cidrhost(local.c.wan.transit_cidr, 1)
    far_gateway  = false
  }

  image_version = tostring(local.c.router.version)
}

module "opnsense" {
  source = "../../modules/opnsense-vm"

  node_name        = local.c.host.node
  vmid             = local.c.router.vmid
  name             = local.c.router.name
  domain           = local.c.internal_domain
  cores            = local.c.router.cores
  memory_mb        = local.c.router.memory_mb
  disk_gb          = local.c.router.disk_gb
  datastore_id     = local.c.host.datastore_vm
  iso_datastore_id = local.c.host.datastore_iso

  image = {
    version   = local.image_version
    url       = var.opnsense_images[local.image_version].url
    file_name = "opnsense-${local.image_version}-nano-amd64.img"
    sha256    = var.opnsense_images[local.image_version].sha256
  }

  wan        = local.wan
  lan_bridge = local.c.host.zones_bridge
  zones      = local.c.zones

  root_password_hash    = local.opn.root_password_bcrypt
  api_key               = local.opn.api_key
  api_secret_crypt      = local.opn.api_secret_crypt
  admin_ssh_public_keys = local.pve.ssh.admin_public_keys

  opnsense_dir = "${path.root}/../../../opnsense"
  build_dir    = "${path.root}/../../../../.state/opnsense"

  auto_import = var.auto_import
  ssh_host    = local.site.ssh_host
  ssh_user    = local.site.ssh_user
}

check "image_pinned" {
  assert {
    condition     = contains(keys(var.opnsense_images), local.image_version)
    error_message = "Aucune image nano épinglée pour router.version=${local.image_version} : ajouter url + sha256 dans var.opnsense_images."
  }
}
