# Stack 15 : image Talos nocloud (Image Factory) et template VM cloné par CAPMOX (bootstrap/).

module "talos_image" {
  source = "../../modules/talos-image"

  node_name           = local.c.host.node
  talos_version       = local.c.kubernetes.talos_version
  extensions          = var.extensions
  vmid                = local.c.kubernetes.talos_template.vmid
  name                = "talos-${replace(local.c.kubernetes.talos_version, ".", "-")}-template"
  datastore_id        = local.c.host.datastore_vm
  import_datastore_id = local.c.host.datastore_iso
  bridge              = local.c.host.zones_bridge
}
