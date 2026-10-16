# LXC de services d'infra : Debian 13, non privilégiés, nesting + keyctl pour Docker.
# Le template est téléchargé une seule fois (checksum vérifié par Proxmox) puis partagé par tous les LXC du module.

resource "proxmox_virtual_environment_download_file" "template" {
  node_name           = var.node_name
  datastore_id        = var.template_datastore_id
  content_type        = "vztmpl"
  url                 = var.template.url
  file_name           = var.template.file_name
  checksum            = var.template.checksum
  checksum_algorithm  = var.template.checksum_algorithm
  overwrite_unmanaged = true
}

resource "proxmox_virtual_environment_container" "this" {
  for_each = var.services

  node_name     = var.node_name
  vm_id         = each.value.vmid
  description   = "pad: service ${each.key} (zone ${each.value.zone}) - géré par OpenTofu, configuré par Ansible"
  tags          = sort(distinct(concat(var.common_tags, ["zone-${each.value.zone}", "svc-${each.key}"], each.value.extra_tags)))
  unprivileged  = true
  start_on_boot = true
  started       = true

  features {
    nesting = true # Docker dans un LXC non privilégié
    keyctl  = true # requis par runc/containerd (keyrings)
  }

  operating_system {
    template_file_id = proxmox_virtual_environment_download_file.template.id
    type             = "debian"
  }

  cpu {
    cores = each.value.cores
  }

  memory {
    dedicated = each.value.memory_mb
    swap      = each.value.swap_mb
  }

  disk {
    datastore_id = var.datastore_id
    size         = each.value.disk_gb
  }

  network_interface {
    name     = "eth0"
    bridge   = var.bridge
    vlan_id  = each.value.vlan
    firewall = false # filtrage assuré par OPNsense entre zones
  }

  initialization {
    hostname = each.key

    ip_config {
      ipv4 {
        address = each.value.ip_cidr
        gateway = each.value.gateway
      }
    }

    dns {
      domain  = var.dns_domain
      servers = [each.value.gateway] # Unbound OPNsense sur le .1 de la zone
    }

    user_account {
      keys = var.ssh_public_keys
    }
  }

  startup {
    order    = each.value.startup_order
    up_delay = 5
  }

  console {
    type = "shell"
  }

  lifecycle {
    # Le mot de passe/clé n'est utilisé qu'à la création ; Ansible gère ensuite les accès.
    # /dev/net/tun (drapeau `tun` du contrat) est ajouté par Ansible (`pct set --dev0`, rôle lxc-tun) : l'API Proxmox
    # le réserve à root@pam, un jeton non-root ne peut pas le poser. Tofu ne doit pas le retirer au prochain apply.
    ignore_changes = [initialization[0].user_account, device_passthrough]
  }
}
