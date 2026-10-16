terraform {
  required_version = ">= 1.10.0"

  required_providers {
    # Provider communautaire maintenu par l'éditeur de Warpgate (warp-tech). 1.2.0 = compatible Warpgate 0.29
    # (version épinglée par le rôle ansible warpgate).
    warpgate = {
      source  = "warp-tech/warpgate"
      version = "1.2.0"
    }
    sops = {
      source  = "carlpett/sops"
      version = "1.4.1"
    }
  }

  backend "local" {
    path = "../../../../.state/tofu/50-warpgate.tfstate"
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
