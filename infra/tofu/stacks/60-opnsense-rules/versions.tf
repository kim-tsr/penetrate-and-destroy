terraform {
  required_version = ">= 1.10.0"

  required_providers {
    opnsense = {
      source  = "browningluke/opnsense"
      version = "0.26.0"
    }
    sops = {
      source  = "carlpett/sops"
      version = "1.4.1"
    }
  }

  backend "local" {
    path = "../../../../.state/tofu/60-opnsense-rules.tfstate"
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
