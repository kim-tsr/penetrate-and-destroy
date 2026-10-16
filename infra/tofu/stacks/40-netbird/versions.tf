terraform {
  required_version = ">= 1.10.0"

  required_providers {
    netbird = {
      source  = "netbirdio/netbird"
      version = "0.0.10"
    }
    sops = {
      source  = "carlpett/sops"
      version = "1.4.1"
    }
  }

  backend "local" {
    path = "../../../../.state/tofu/40-netbird.tfstate"
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
