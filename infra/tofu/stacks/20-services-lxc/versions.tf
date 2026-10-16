terraform {
  required_version = ">= 1.10.0"

  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.116.1"
    }
    sops = {
      source  = "carlpett/sops"
      version = "1.4.1"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.9.1"
    }
  }

  backend "local" {
    path = "../../../../.state/tofu/20-services-lxc.tfstate"
  }

  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
