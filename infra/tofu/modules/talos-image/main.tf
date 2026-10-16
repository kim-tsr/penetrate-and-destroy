# Image Talos nocloud (Image Factory) + template VM cloné par CAPMOX.
# Le schematic (extensions) est enregistré auprès de l'Image Factory : son ID est un hash du contenu,
# donc l'image est entièrement déterminée par (schematic, version Talos, plateforme, arch).
# L'Image Factory ne publie pas de checksum : l'intégrité repose sur ce couple + TLS.

resource "talos_image_factory_schematic" "this" {
  schematic = yamlencode({
    customization = {
      systemExtensions = {
        officialExtensions = var.extensions
      }
    }
  })
}

data "talos_image_factory_urls" "this" {
  talos_version     = var.talos_version
  schematic_id      = talos_image_factory_schematic.this.id
  platform          = "nocloud"
  architecture      = "amd64"
  disk_image_format = "qcow2" # le contenu "import" de Proxmox refuse la décompression : qcow2 non compressé
}

locals {
  schematic_short = substr(talos_image_factory_schematic.this.id, 0, 12)
  image_file_name = "talos-${var.talos_version}-${local.schematic_short}-nocloud-amd64.qcow2"
}

resource "proxmox_virtual_environment_download_file" "image" {
  node_name           = var.node_name
  datastore_id        = var.import_datastore_id
  content_type        = "import" # nécessite le contenu "import" sur le datastore (ansible host-tuning)
  url                 = data.talos_image_factory_urls.this.urls.disk_image
  file_name           = local.image_file_name
  checksum            = var.image_checksum
  checksum_algorithm  = var.image_checksum == null ? null : "sha256"
  overwrite           = false
  overwrite_unmanaged = true
  upload_timeout      = 1800
}

resource "proxmox_virtual_environment_vm" "template" {
  node_name   = var.node_name
  vm_id       = var.vmid
  name        = var.name
  description = "pad: template Talos ${var.talos_version} (schematic ${talos_image_factory_schematic.this.id}) - cloné par CAPMOX"
  tags        = sort(distinct(concat(var.tags, ["talos-${replace(var.talos_version, ".", "-")}"])))
  template    = true
  started     = false
  on_boot     = false

  machine       = "q35"
  bios          = "seabios"
  scsi_hardware = "virtio-scsi-single"

  operating_system {
    type = "l26"
  }

  agent {
    enabled = true # extension siderolabs/qemu-guest-agent
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
    import_from  = proxmox_virtual_environment_download_file.image.id
    size         = var.disk_gb
    discard      = "on"
    ssd          = true
    iothread     = true
    file_format  = "raw"
  }

  network_device {
    bridge = var.bridge
    model  = "virtio"
  }

  serial_device {}

  lifecycle {
    # import_from n'est lu qu'à la création ; une nouvelle image => nouveau nom de fichier => remplacement.
    replace_triggered_by = [proxmox_virtual_environment_download_file.image.id]
  }
}
