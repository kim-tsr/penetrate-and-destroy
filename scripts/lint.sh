#!/usr/bin/env bash
# Vérifications statiques identiques en local et en CI (task lint).
#
# Un outil absent fait SAUTER l'étape concernée (avertissement SKIP) ; PAD_LINT_STRICT=1 (CI, nix develop) le
# transforme en échec. PAD_LINT_FULL=1 ajoute les étapes lentes ou réseau : pytest CTFd (clone du harnais officiel),
# build du front, docker compose build de la pile e2e.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
skipped=0
step() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
# need <outil>... : retourne 0 si tous les outils sont présents, sinon SKIP (ou échec en mode strict).
need() {
  local t
  for t in "$@"; do
    if ! have "$t"; then
      if [ "${PAD_LINT_STRICT:-0}" = 1 ]; then
        echo "KO   outil manquant : $t"
        fail=1
      else
        echo "SKIP outil manquant : $t"
        skipped=$((skipped + 1))
      fi
      return 1
    fi
  done
}

step "Cohérence contrats (IPs clés présentes dans les manifests)"
if need yq; then
  ingress_ip=$(yq -r '.kubernetes.ingress_ip' infra/contracts.yaml)
  vip=$(yq -r '.kubernetes.control_plane_endpoint' infra/contracts.yaml)
  grep -rq "$vip" gitops/clusters/prod 2>/dev/null || { echo "VIP $vip absente de gitops/clusters/prod"; fail=1; }
  grep -rq "$ingress_ip" gitops/platform 2>/dev/null || { echo "ingress_ip $ingress_ip absente de gitops/platform"; fail=1; }
fi

step "Secrets : fichiers chiffrés bien formés, aucun secret ni clé en clair (scripts/check-sops.sh)"
scripts/check-sops.sh || fail=1

step "Valeurs propres à un site réel (scripts/check-site-leaks.sh : empreintes sha256, aucun motif en clair)"
scripts/check-site-leaks.sh || fail=1

step "gitleaks (repo public : historique + arbre de travail)"
if need gitleaks; then
  gitleaks git --redact --no-banner --exit-code 1 . || fail=1
  gitleaks dir --redact --no-banner --exit-code 1 . || fail=1
fi

step "OpenTofu (fmt + validate de chaque stack, y compris 40-netbird et 50-warpgate dès qu'ils existent)"
if need tofu; then
  tofu fmt -check -recursive infra/tofu || fail=1
  for s in infra/tofu/stacks/*/; do
    (cd "$s" && tofu init -backend=false -input=false >/dev/null && tofu validate) || fail=1
  done
fi

step "Ansible"
if need ansible-lint; then
  if [ -d infra/ansible ]; then (cd infra/ansible && ansible-lint) || fail=1; fi
fi

step "Manifests Kubernetes (kustomize + ksops + kubeconform, sops factices à clé éphémère)"
if need age-keygen sops ksops kustomize kubeconform; then
  scripts/validate-gitops.sh || fail=1
fi

step "Shell (shellcheck : scripts, bootstrap, challenges, tests)"
if need shellcheck; then
  find scripts bootstrap challenges tests -name '*.sh' -not -path '*/node_modules/*' -print0 2>/dev/null \
    | xargs -0 -r shellcheck -x || fail=1
fi

step "Workflows GitHub Actions (actionlint)"
if need actionlint; then actionlint || fail=1; fi

step "Taskfiles (task --list-all : racine et inclus)"
if need task; then
  tasks_out=$(task --list-all) || fail=1
  for t in up destroy rebuild backup restore verify e2e load lint; do
    grep -qE "^\* ${t}:" <<<"$tasks_out" || { echo "tâche racine manquante : $t"; fail=1; }
  done
fi

step "Scripts d'exploitation (aide de backup/restore, python du mock chall-manager)"
scripts/backup.sh --help >/dev/null || fail=1
scripts/restore.sh --help >/dev/null || fail=1
if have python3; then
  python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' tests/e2e/mock-chall-manager/server.py || fail=1
fi

step "Tests e2e (docker compose config) et charge (k6 inspect)"
if need docker; then
  docker compose -f tests/e2e/docker-compose.yml config -q || fail=1
  COMPOSE_PROFILES=front docker compose -f tests/e2e/docker-compose.yml config -q || fail=1
  if [ "${PAD_LINT_FULL:-0}" = 1 ]; then docker compose -f tests/e2e/docker-compose.yml build chall-manager || fail=1; fi
fi
if need k6; then
  k6 inspect tests/load/pad.js >/dev/null || fail=1
  PAD_PROFILE=load PAD_FLAG_CHALLENGE_ID=1 PAD_INSTANCE_CHALLENGE_IDS=2 k6 inspect tests/load/pad.js >/dev/null || fail=1
fi

step "Tests Go (netbird-sync, chall-manager-scenario)"
if need go; then
  for m in apps/netbird-sync apps/chall-manager-scenario; do
    if [ -f "$m/go.mod" ]; then (cd "$m" && go vet ./... && go test ./...) || fail=1; fi
  done
fi

step "Tests pytest CTFd (plugins pad_*)"
if [ "${PAD_LINT_FULL:-0}" = 1 ]; then
  bash apps/ctfd/scripts/test.sh || fail=1
else
  echo "SKIP (PAD_LINT_FULL=1 pour lancer le harnais CTFd, qui clone CTFd et installe ses dépendances)"
fi

step "Frontend (lint, typecheck, test$([ "${PAD_LINT_FULL:-0}" = 1 ] && echo ', build'))"
if [ -f apps/frontend/package.json ]; then
  if need pnpm; then
    (
      cd apps/frontend
      pnpm install --frozen-lockfile >/dev/null && pnpm lint && pnpm typecheck && pnpm test
      if [ "${PAD_LINT_FULL:-0}" = 1 ]; then pnpm build; fi
    ) || fail=1
  fi
fi

step "Sécurité IaC (checkov, trivy : secrets et configuration)"
if have checkov; then checkov -d infra --quiet --compact --soft-fail >/dev/null || true; else need checkov || true; fi
if need trivy; then
  trivy fs --scanners secret --exit-code 1 --skip-dirs .git --skip-dirs node_modules --skip-dirs .state . >/dev/null || fail=1
  # trivy config n'accepte qu'une seule cible : un appel par dossier (comme la CI).
  for d in gitops apps infra; do
    trivy config --exit-code 1 --severity HIGH,CRITICAL "$d" >/dev/null || fail=1
  done
fi

printf '\nRésumé : %s étape(s) sautée(s), %s\n' "$skipped" "$([ "$fail" -eq 0 ] && echo OK || echo ÉCHEC)"
exit "$fail"
