# Stack 20 : LXC des services d'infra (contrat `services`) + inventaire Ansible généré.

locals {
  services = {
    for name, s in local.c.services : name => {
      vmid      = s.vmid
      zone      = s.zone
      vlan      = local.c.zones[s.zone].vlan
      ip_cidr   = "${s.ip}/${split("/", local.c.zones[s.zone].cidr)[1]}"
      gateway   = local.c.zones[s.zone].gw
      cores     = s.cores
      memory_mb = s.memory_mb
      disk_gb   = s.disk_gb
    }
  }
}

module "lxc" {
  source = "../../modules/lxc-service"

  node_name             = local.c.host.node
  datastore_id          = local.c.host.datastore_vm
  template_datastore_id = local.c.host.datastore_iso
  template              = var.lxc_template
  bridge                = local.c.host.zones_bridge
  dns_domain            = local.c.internal_domain
  ssh_public_keys       = [local.pve.ssh.ansible_public_key]
  services              = local.services
}

# --- Inventaire Ansible -------------------------------------------------------------------------
# Groupes : `proxmox_host`, `lxc` (tous), `svc_<service>` (un par LXC), `zone_<zone>`. Variables d'hôte : ansible_host, vmid, zone, pad_service.
locals {
  containers = module.lxc.containers

  inventory = {
    all = {
      children = merge(
        {
          # Hôte Proxmox : adresse et utilisateur lus par Ansible dans secrets/site.sops.yaml (rien n'est écrit ici).
          proxmox_host = {
            hosts = {
              (local.c.host.node) = {
                ansible_host = "{{ pad_site.ssh_host }}"
              }
            }
          }
          lxc = {
            hosts = {
              for name, ct in local.containers : name => {
                ansible_host = ct.ip
                ansible_user = "root"
                vmid         = ct.vmid
                zone         = ct.zone
                vlan         = ct.vlan
                pad_service  = name
              }
            }
          }
        },
        { for name, ct in local.containers : "svc_${name}" => { hosts = { (name) = null } } },
        {
          for zone in distinct([for ct in local.containers : ct.zone]) : "zone_${zone}" => {
            hosts = { for name, ct in local.containers : name => null if ct.zone == zone }
          }
        },
      )
    }
  }
}

resource "local_file" "ansible_inventory" {
  filename        = "${path.root}/../../../ansible/inventories/prod/hosts.generated.yml"
  file_permission = "0644"
  content = join("\n", [
    "# GÉNÉRÉ par infra/tofu/stacks/20-services-lxc - ne pas éditer à la main.",
    "# Source : infra/contracts.yaml (services, zones) + VMIDs/IPs effectifs des LXC.",
    yamlencode(local.inventory),
  ])
}
