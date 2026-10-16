#!/usr/bin/env bash
# Smoke tests post-déploiement. Lancé depuis un poste staff connecté à NetBird (ou via le bastion).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C="$ROOT/infra/contracts.yaml"
DOMAIN=$(yq '.domain' "$C")
ok=0; ko=0
check() { if eval "$2" >/dev/null 2>&1; then echo "OK  $1"; ok=$((ok+1)); else echo "KO  $1"; ko=$((ko+1)); fi; }

for h in front auth vpn status; do
  name="$(yq ".hostnames.$h" "$C").$DOMAIN"
  check "HTTPS public $name" "curl -fsS --max-time 10 -o /dev/null https://$name"
done
check "OIDC discovery Authentik" "curl -fsS https://$(yq '.hostnames.auth' "$C").$DOMAIN/application/o/$(yq '.identity.oidc_clients.frontend' "$C")/.well-known/openid-configuration"
check "Front /api/health" "curl -fsS https://$(yq '.hostnames.front' "$C").$DOMAIN/api/health"

export KUBECONFIG="${KUBECONFIG:-$ROOT/.state/kubeconfig}"
check "Nœuds Kubernetes Ready" "! kubectl get nodes --no-headers | grep -v ' Ready'"
check "Applications ArgoCD Synced/Healthy" \
  "test -z \"\$(kubectl -n argocd get applications -o jsonpath='{range .items[*]}{.status.sync.status}/{.status.health.status}{\"\\n\"}{end}' | grep -v '^Synced/Healthy$')\""
check "Cluster CAPI Provisioned" "kubectl get cluster -A -o jsonpath='{.items[0].status.phase}' | grep -q Provisioned"

# Matrice de flux : la zone challenges ne doit rien joindre hors API kube/DNS.
check "Isolation challenges -> identity" \
  "! kubectl run nettest-\$RANDOM --rm -i --restart=Never --image=busybox:1.37 \
     --overrides='{\"spec\":{\"nodeSelector\":{\"pad.io/pool\":\"challenges\"},\"tolerations\":[{\"operator\":\"Exists\"}]}}' \
     -- nc -zw3 $(yq '.services.authentik.ip' "$C") 443"

check "VictoriaMetrics up" "curl -fsS http://$(yq '.services.monitoring.ip' "$C"):8428/health"

echo; echo "Résultat : $ok OK, $ko KO"; [ "$ko" -eq 0 ]
