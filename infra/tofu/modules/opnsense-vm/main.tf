# VM OPNsense (routeur/firewall des zones).
# Chaîne de bootstrap (détails : infra/opnsense/README.md) :
#   image nano épinglée (sha256) -> disque de la VM
#   config.xml.tmpl --templatefile--> .state/opnsense/<vm>/iso/conf/config.xml --xorriso--> ISO --upload--> cdrom ide2
#   1er boot : opnsense-importer copie /conf/config.xml depuis le cdrom (console série pilotée par import-config.sh).

locals {
  opnsense_dir = abspath(var.opnsense_dir)
  build_dir    = abspath("${var.build_dir}/${var.name}")

  # Zones triées par VLAN : la première (mgmt, VLAN 10) devient "lan", les suivantes opt1..optN.
  zone_names = [for z in sort([for name, z in var.zones : format("%04d-%s", z.vlan, name)]) : split("-", z)[1]]
  zones = [
    for idx, name in local.zone_names : {
      name      = name
      key       = idx == 0 ? "lan" : "opt${idx}"
      vlan      = var.zones[name].vlan
      vlanif    = "vlan0.${var.zones[name].vlan}"
      ip        = var.zones[name].gw
      prefix    = split("/", var.zones[name].cidr)[1]
      vlan_uuid = uuidv5("url", "https://pad.local/opnsense/vlan/${var.zones[name].vlan}")
    }
  ]
  interface_by_zone = { for z in local.zones : z.name => z.key }

  # Redirections de ports WAN (DNAT) au format legacy de config.xml (l'API d_nat n'existe qu'à partir d'OPNsense 26.1).
  # Plage "a-b" : local-port = a, pf conserve le décalage (la cible reçoit la même plage).
  nat_rules = [
    for pf in var.port_forwards : {
      uuid       = uuidv5("url", "https://pad.local/opnsense/nat/${lower(pf.proto)}/${pf.port}")
      proto      = lower(pf.proto)
      port       = pf.port
      local_port = split("-", pf.port)[0]
      target     = pf.target
      descr      = "pad WAN ${upper(pf.proto)} ${pf.port} vers ${pf.name}"
    }
  ]

  config_xml = templatefile("${local.opnsense_dir}/config.xml.tmpl", {
    hostname                 = var.name
    domain                   = var.domain
    root_password_hash       = var.root_password_hash
    root_authorized_keys_b64 = base64encode(join("\n", var.admin_ssh_public_keys))
    api_key                  = var.api_key
    api_secret_crypt         = var.api_secret_crypt
    webgui_interfaces        = join(",", [for z in var.webgui_zones : local.interface_by_zone[z]])
    ssh_interfaces           = join(",", [for z in var.ssh_zones : local.interface_by_zone[z]])
    unbound_interfaces       = join(",", [for z in local.zones : z.key])
    trunk_if                 = "vtnet1"
    gateway_uuid             = uuidv5("url", "https://pad.local/opnsense/gateway/wan")
    zones                    = local.zones
    nat_rules                = local.nat_rules
    wan = {
      "if"        = "vtnet0"
      ipaddr      = split("/", var.wan.address_cidr)[0]
      subnet      = split("/", var.wan.address_cidr)[1]
      gateway     = var.wan.gateway
      far_gateway = var.wan.far_gateway
      blockpriv   = var.wan.mode == "routed_ip" # en mode nat, le WAN est lui-même en RFC1918
    }
  })
  config_sha = sha256(local.config_xml)
  iso_name   = "${var.name}-config-${substr(local.config_sha, 0, 12)}.iso"
}

# --- Image nano OPNsense, épinglée par checksum -------------------------------------------------
# Le contenu "import" de Proxmox refuse la décompression : on télécharge en contenu "iso" (bz2 -> .img),
# puis le disque est importé via disk.file_id (bpg utilise alors SSH vers le node).
resource "proxmox_virtual_environment_download_file" "nano" {
  node_name               = var.node_name
  datastore_id            = var.iso_datastore_id
  content_type            = "iso"
  url                     = var.image.url
  file_name               = var.image.file_name
  checksum                = var.image.sha256
  checksum_algorithm      = "sha256"
  decompression_algorithm = "bz2"
  overwrite               = false
  overwrite_unmanaged     = true
  upload_timeout          = 1800
}

# --- ISO de configuration -------------------------------------------------------------------
resource "local_sensitive_file" "config_xml" {
  filename        = "${local.build_dir}/iso/conf/config.xml"
  content         = local.config_xml
  file_permission = "0600"
}

resource "null_resource" "config_iso" {
  triggers = {
    config_sha = local.config_sha
    iso        = local.iso_name
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = "'${local.opnsense_dir}/build-config-iso.sh' '${local.build_dir}/iso' '${local.build_dir}/${local.iso_name}'"
  }

  depends_on = [local_sensitive_file.config_xml]
}

resource "proxmox_virtual_environment_file" "config_iso" {
  node_name    = var.node_name
  datastore_id = var.iso_datastore_id
  content_type = "iso"

  source_file {
    path      = "${local.build_dir}/${local.iso_name}"
    file_name = local.iso_name
  }

  depends_on = [null_resource.config_iso]
}

# --- VM -------------------------------------------------------------------------------------
resource "proxmox_virtual_environment_vm" "this" {
  node_name   = var.node_name
  vm_id       = var.vmid
  name        = var.name
  description = "pad: routeur OPNsense ${var.image.version} (WAN ${var.wan.mode}) - géré par OpenTofu"
  tags        = var.tags
  on_boot     = true
  started     = true

  machine       = "q35"
  bios          = "seabios"
  scsi_hardware = "virtio-scsi-single"
  boot_order    = ["scsi0"]

  operating_system {
    type = "other" # FreeBSD
  }

  agent {
    enabled = false # pas d'agent dans l'image nano par défaut
  }

  cpu {
    cores = var.cores
    type  = "host"
  }

  memory {
    dedicated = var.memory_mb
  }

  disk {
    interface    = "scsi0"
    datastore_id = var.datastore_id
    file_id      = proxmox_virtual_environment_download_file.nano.id
    file_format  = "raw"
    size         = var.disk_gb
    discard      = "on"
    ssd          = true
    iothread     = true
  }

  cdrom {
    interface = "ide2"
    file_id   = proxmox_virtual_environment_file.config_iso.id
  }

  # vtnet0 : WAN
  network_device {
    bridge      = var.wan.bridge
    model       = "virtio"
    mac_address = var.wan.mac_address
    firewall    = false
  }

  # vtnet1 : trunk des VLANs des zones (non taggé côté Proxmox, VLANs créés dans OPNsense)
  network_device {
    bridge   = var.lan_bridge
    model    = "virtio"
    firewall = false
  }

  # Console série (socket QEMU) : console primaire de l'image nano, pilotée par import-config.sh pour l'importer.
  serial_device {}

  lifecycle {
    # La config n'est importée qu'au premier boot : changer l'ISO ensuite ne doit pas recréer la VM.
    # Pour réimporter : tofu apply -replace=<module>.proxmox_virtual_environment_vm.this
    ignore_changes = [cdrom, disk[0].file_id]
  }
}

resource "null_resource" "import_config" {
  count = var.auto_import ? 1 : 0

  triggers = {
    vm = proxmox_virtual_environment_vm.this.id
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = "'${local.opnsense_dir}/import-config.sh'"
    environment = {
      SSH_HOST = var.ssh_host
      SSH_USER = var.ssh_user
      VMID     = tostring(var.vmid)
    }
  }
}
