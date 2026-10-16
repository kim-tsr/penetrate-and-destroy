# Targets Warpgate vers les zones. Toutes les IPs viennent du contrat ; le flux BASTION -> zones
# (SSH 22, HTTPS 443, Proxmox 8006) est ouvert par le stack 60-opnsense-rules.
#
# Authentification SSH côté target : clé publique propre à Warpgate (public_key_auth sans key_id).
# La clé publique de Warpgate doit figurer dans authorized_keys des cibles (cf. output warpgate_client_public_keys).

locals {
  ssh_port   = local.c.flow_ports.ssh
  https_port = local.c.flow_ports.https

  # LXC de services accessibles en SSH (sauf warpgate lui-même).
  lxc_ssh_targets = {
    for k, s in local.c.services : "lxc-${k}" => {
      description = "LXC ${k} (zone ${s.zone})"
      host        = s.ip
    } if k != "warpgate"
  }

  ssh_targets = merge(
    local.lxc_ssh_targets,
    {
      "opnsense-ssh" = {
        description = "Routeur OPNsense (SSH, zone MGMT)"
        host        = local.c.zones.mgmt.gw
      }
    },
  )

  http_targets = {
    "opnsense-ui" = {
      description = "UI web OPNsense (zone MGMT)"
      url         = "https://${local.c.zones.mgmt.gw}:${var.opnsense_ui_port}"
    }
    "proxmox-api" = {
      description = "UI/API Proxmox VE (IP MGMT de l'hôte)"
      url         = "https://${local.c.host.mgmt_ip}:${local.c.flow_ports.proxmox_api}"
    }
  }
}

resource "warpgate_target" "ssh" {
  for_each = local.ssh_targets

  name        = each.key
  description = each.value.description

  ssh_options {
    host     = each.value.host
    port     = local.ssh_port
    username = var.lxc_ssh_username

    public_key_auth {}
  }
}

# Hôte Proxmox (« nœud ») : utilisateur non-root.
resource "warpgate_target" "proxmox_host_ssh" {
  name        = "proxmox-host-ssh"
  description = "Hôte Proxmox (SSH, IP MGMT)"

  ssh_options {
    host     = local.c.host.mgmt_ip
    port     = local.ssh_port
    username = local.site.ssh_user # secrets/site.sops.yaml

    public_key_auth {}
  }
}

resource "warpgate_target" "http" {
  for_each = local.http_targets

  name        = each.key
  description = each.value.description

  http_options {
    url = each.value.url

    tls {
      mode   = "Required"
      verify = var.tls_verify_internal
    }
  }
}

# Les nœuds Talos n'ont pas de SSH (API-only) : accès via talosctl depuis le bastion (flux BASTION -> 50000).
# TODO : target kubernetes_options (API kube 6443) quand un jeton ou certificat de service sera provisionné.

locals {
  all_target_ids = merge(
    { for k, t in warpgate_target.ssh : k => t.id },
    { for k, t in warpgate_target.http : k => t.id },
    { "proxmox-host-ssh" = warpgate_target.proxmox_host_ssh.id },
  )

  # Toutes les targets sont ouvertes à chaque rôle d'accès (groupes de var.access_groups).
  target_role_pairs = {
    for pair in setproduct(keys(local.all_target_ids), tolist(var.access_groups)) :
    "${pair[0]}/${pair[1]}" => { target = pair[0], role = pair[1] }
  }
}

resource "warpgate_target_role" "access" {
  for_each = local.target_role_pairs

  target_id = local.all_target_ids[each.value.target]
  role_id   = warpgate_role.access[each.value.role].id
}
