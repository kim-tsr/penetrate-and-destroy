#!/usr/bin/env bash
# Valide toute la supervision versionnée : dashboards, règles, Alertmanager, sondes Uptime Kuma, rôle Ansible.
#
#   monitoring/scripts/check.sh            # depuis la racine du dépôt (ou `nix develop -c monitoring/scripts/check.sh`)
#
# Outils : python3 + PyYAML + Jinja2, jq ; promtool, amtool, vmalert(-prod), ansible-lint (optionnels, SKIP s'ils manquent ;
# PAD_REQUIRE_TOOLS=1 transforme un outil manquant en échec, utile en CI). Chemins surchargeables : PROMTOOL, AMTOOL, VMALERT.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export PAD_REQUIRE_TOOLS="${PAD_REQUIRE_TOOLS:-0}"

fail=0
step() { printf '\n== %s\n' "$1"; }
run() { "$@" || { echo "  ECHEC: $*"; fail=1; }; }
have() { command -v "$1" >/dev/null 2>&1; }
need() { # need <nom> <variable-override> : définit le chemin ou SKIP
  local path="${!2:-}"
  [[ -n "$path" ]] || path="$(command -v "$1" || true)"
  printf '%s' "$path"
}

PROMTOOL="$(need promtool PROMTOOL)"
VMALERT="$(need vmalert-prod VMALERT)"
[[ -n "$VMALERT" ]] || VMALERT="$(need vmalert VMALERT)"
AMTOOL="$(need amtool AMTOOL)"
export PROMTOOL AMTOOL
missing() {
  echo "  SKIP: $1 introuvable"
  [[ "$PAD_REQUIRE_TOOLS" != "1" ]] || { echo "  ECHEC: $1 requis (PAD_REQUIRE_TOOLS=1)"; fail=1; }
}

step "JSON des dashboards (jq)"
if have jq; then
  for f in monitoring/dashboards/*.json; do
    if jq -e '.uid and .title and (.panels | length > 0)' "$f" >/dev/null; then
      echo "  OK $f"
    else
      echo "  ECHEC $f"
      fail=1
    fi
  done
else missing jq; fi

step "Dashboards : structure, uid, datasources, PromQL"
run python3 -I monitoring/scripts/validate.py dashboards

step "Dashboards : régénération reproductible"
tmp_dash="$(mktemp -d)"
trap 'rm -rf "$tmp_dash"' EXIT
cp -r monitoring/dashboards "$tmp_dash/before"
run python3 -I monitoring/scripts/build_dashboards.py >/dev/null
if diff -r "$tmp_dash/before" monitoring/dashboards >/dev/null; then echo "  OK dashboards/*.json à jour avec build_dashboards.py"
else echo "  ECHEC: dashboards/*.json diffèrent de la sortie de build_dashboards.py (relancer le script)"; fail=1; fi

step "Règles : conventions (severity, runbook_url, annotations)"
run python3 -I monitoring/scripts/validate.py rules

step "Règles : promtool check rules"
if [[ -n "$PROMTOOL" ]]; then run "$PROMTOOL" check rules monitoring/rules/*.yml; else missing promtool; fi

step "Règles : tests unitaires (promtool test rules)"
if [[ -n "$PROMTOOL" ]]; then run "$PROMTOOL" test rules monitoring/tests/rules/*.test.yml; else missing promtool; fi

step "Règles : vmalert -dryRun"
if [[ -n "$VMALERT" ]]; then
  run "$VMALERT" -dryRun -rule='monitoring/rules/*.yml' -datasource.url=http://127.0.0.1:8428 -notifier.url=http://127.0.0.1:9093
else missing vmalert; fi

step "Alertmanager : rendu du template, check-config, routage"
run python3 -I monitoring/scripts/validate.py alertmanager

step "Uptime Kuma : sondes déclaratives (dry-run)"
run python3 -I monitoring/uptime-kuma/sync.py --dry-run

step "Secrets, IP publiques, noms d'hôtes réels"
run python3 -I monitoring/scripts/validate.py secrets

step "ansible-lint (rôle monitoring-stack)"
if have ansible-lint; then
  (cd infra/ansible && run ansible-lint roles/monitoring-stack)
else missing ansible-lint; fi

echo
if [[ "$fail" -ne 0 ]]; then echo "ECHEC : au moins un contrôle a échoué"; exit 1; fi
echo "OK : tous les contrôles ont réussi"
