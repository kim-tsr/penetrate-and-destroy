#!/usr/bin/env bash
# Installe ArgoCD dans pad-prod, ses secrets (clé age ksops, deploy key du repo) et l'Application root.
# Idempotent : helm upgrade --install, secrets appliqués par `kubectl apply`.
# shellcheck source=bootstrap/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

require_cmd kubectl helm yq sops age-keygen
[[ -s "$PROD_KUBECONFIG" ]] || die "kubeconfig absent (${PROD_KUBECONFIG}) : lancer d'abord 'task bootstrap:cluster'"
: "${SOPS_AGE_KEY_FILE:?SOPS_AGE_KEY_FILE doit pointer vers la clé age privée opérateur (pas celle du cluster)}"
[[ -r "$SOPS_AGE_KEY_FILE" ]] || die "clé age illisible : ${SOPS_AGE_KEY_FILE}"

# Clé age du CLUSTER (distincte de celle de l'opérateur) : seule celle-ci est injectée dans ArgoCD. Elle reste hors repo
# (générée par `task secrets:keys`) et doit figurer comme recipient dans .sops.yaml (règle gitops/**).
CLUSTER_AGE_KEY_FILE="${PAD_CLUSTER_AGE_KEY_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/pad/cluster.agekey}"
[[ -r "$CLUSTER_AGE_KEY_FILE" ]] || die "clé age du cluster illisible : ${CLUSTER_AGE_KEY_FILE} (la créer avec 'task secrets:keys', ou PAD_CLUSTER_AGE_KEY_FILE)"
cluster_pub=$(age-keygen -y "$CLUSTER_AGE_KEY_FILE") || die "clé age du cluster invalide : ${CLUSTER_AGE_KEY_FILE}"
operator_pub=$(age-keygen -y "$SOPS_AGE_KEY_FILE" 2>/dev/null | head -n1 || true)
[[ "$cluster_pub" != "$operator_pub" ]] || die "la clé du cluster est identique à celle de l'opérateur : ne jamais mettre la clé opérateur dans le cluster"
grep -q "$cluster_pub" "${ROOT_DIR}/.sops.yaml" \
  || die "la clé publique du cluster (${cluster_pub}) n'est pas recipient dans .sops.yaml : lancer 'task secrets:update-keys'"

ARGO_NS=argocd
DEPLOY_KEY_SOPS="${ROOT_DIR}/secrets/github-deploy-key.sops.yaml"
ROOT_APP="${GITOPS_DIR}/bootstrap/root.yaml"
[[ -f "$ROOT_APP" ]] || die "manquant : ${ROOT_APP}"

# 1. ArgoCD (version et values lues dans gitops/platform/argocd/).
helm_from_app argocd argo-cd argocd "$ARGO_NS"

# 2. Secret sops-age : clé privée du CLUSTER pour ksops (repo-server). Passe par un pipe, jamais par un fichier temporaire.
log "Secret sops-age (clé du cluster ${cluster_pub})"
kprod -n "$ARGO_NS" create secret generic sops-age \
  --from-file=keys.txt="$CLUSTER_AGE_KEY_FILE" --dry-run=client -o yaml | kprod apply -f -

# 3. Secret repo : deploy key SSH (déchiffrée via substitution de processus).
log "Secret repo ArgoCD (deploy key)"
repo_ssh=$(contract '.git.ssh')
kprod -n "$ARGO_NS" create secret generic repo-pad \
  --from-literal=type=git --from-literal=url="$repo_ssh" \
  --from-file=sshPrivateKey=<(sops_get "$DEPLOY_KEY_SOPS" '["github"]["deploy_key"]') \
  --dry-run=client -o yaml \
  | kprod label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
  | kprod apply -f -

# 4. Application root (app-of-apps).
log "Application root"
kprod apply -f "$ROOT_APP"
# root.yaml est multi-documents (AppProjects, ApplicationSet) : ne retenir que l'Application.
root_name=$(yq -e 'select(.kind == "Application") | .metadata.name' "$ROOT_APP")
root_ns=$(yq -e 'select(.kind == "Application") | .metadata.namespace // "argocd"' "$ROOT_APP")

root_synced() { [[ "$(kprod -n "$root_ns" get application "$root_name" -o jsonpath='{.status.sync.status}')" == "Synced" ]]; }
wait_for 900 "Application ${root_name} Synced" root_synced
log "ArgoCD en place ; la suite est pilotée par GitOps (kubectl --kubeconfig ${PROD_KUBECONFIG} -n ${ARGO_NS} get applications)"
