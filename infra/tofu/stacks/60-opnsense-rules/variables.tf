variable "state_passphrase" {
  description = "Passphrase de chiffrement du state (TF_VAR_state_passphrase)."
  type        = string
  sensitive   = true
}

variable "opnsense_uri" {
  description = "URI de l'API OPNsense ; null = https://<gw mgmt> du contrat."
  type        = string
  default     = null
}

variable "opnsense_allow_insecure" {
  description = "Accepter le certificat auto-signé de la GUI OPNsense (bootstrap)."
  type        = bool
  default     = true
}

variable "challenges_egress_allowlist" {
  description = "Destinations Internet autorisées depuis CHALLENGES (IPs/CIDR/FQDN), ports 80/443. Vide = aucun egress."
  type        = list(string)
  default     = []
}

# --- Règles d'infrastructure hors matrice (activables une à une) ---------------------------------
# La matrice du PLAN ne décrit que les flux applicatifs. Ces flux sont nécessaires au fonctionnement
# de la plateforme ; chacun est désactivable pour s'en tenir strictement à la matrice.

variable "internet_egress_zones" {
  description = "Zones autorisées à sortir sur Internet (80/443 TCP, 53 TCP/UDP, 123 UDP) : apt, pulls d'images, ACME, NTP. CHALLENGES passe par l'allowlist."
  type        = list(string)
  default     = ["mgmt", "dmz", "bastion", "identity", "monitoring", "prod"]
}

variable "allow_dns_all_zones" {
  description = "Toutes les zones -> Unbound sur leur .1 (53 TCP/UDP). Pour CHALLENGES, c'est déjà dans la matrice."
  type        = bool
  default     = true
}

variable "allow_oidc_all_zones" {
  description = "Toutes les zones -> edge:443 (split-DNS : les noms publics résolvent vers l'edge ; back-channel OIDC de NetBird, Warpgate, Grafana, ArgoCD, front, Proxmox, puis edge -> authentik par la règle M3)."
  type        = bool
  default     = true
}

variable "allow_kube_cross_zone" {
  description = "Trafic inter-nœuds Kubernetes PROD <-> CHALLENGES, asymétrique : Cilium (VXLAN/WireGuard/health/Hubble), kubelet du control plane vers les workers, trustd des workers vers le control plane. Ni kubelet ni apid du control plane depuis les workers (apid : bastion seul)."
  type        = bool
  default     = true
}

variable "allow_edge_status_page" {
  description = "edge -> monitoring:uptime_kuma (status page publique)."
  type        = bool
  default     = true
}

variable "allow_netbird_routers" {
  description = "Règles des routing peers NetBird (nbrouter en CHALLENGES, warpgate en BASTION) : HTTPS vers le management/signal/relay, STUN, NTP et apt pour nbrouter. Sans elles, aucun joueur ni staff ne rejoint le VPN."
  type        = bool
  default     = true
}

variable "netbird_routers_direct_udp" {
  description = "Autoriser les routing peers à sortir en UDP 1024-65535 vers Internet (WireGuard direct avec les pairs, traversée de NAT). false = tout passe par le relay NetBird en HTTPS (plus lent, surface réduite)."
  type        = bool
  default     = true
}
