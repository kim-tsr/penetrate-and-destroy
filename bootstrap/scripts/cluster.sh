#!/usr/bin/env bash
# Crée le cluster Kubernetes pad-prod : kind éphémère -> CAPI/CAPMOX/Talos -> CNI -> pivot -> suppression de kind.
# Idempotent et reprenable : chaque étape détecte son état et se saute si elle est déjà faite.
# Prérequis : sops (SOPS_AGE_KEY_FILE), secrets/proxmox.sops.yaml, kind, docker, kubectl, helm, clusterctl, yq.
# shellcheck source=bootstrap/scripts/capi-common.sh
source "$(dirname "$0")/capi-common.sh"

require_cmd kind docker kubectl helm clusterctl yq sops base64

# Le cluster cible gère-t-il déjà son propre objet Cluster (pivot fait) ?
has_prod_managing() {
  [[ -s "$PROD_KUBECONFIG" ]] && has_cluster "$PROD_KUBECONFIG"
}

cluster_provisioned() { [[ "$(kkind -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" -o jsonpath='{.status.phase}')" == "Provisioned" ]]; }
control_plane_ready() { [[ "$(kkind -n "$CLUSTER_NS" get taloscontrolplane "${CLUSTER_NAME}-cp" -o jsonpath='{.status.ready}')" == "true" ]]; }
cluster_phase_prod() { [[ "$(kprod -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" -o jsonpath='{.status.phase}')" == "Provisioned" ]]; }

# --- 1. Cluster de gestion éphémère ---
step_kind() {
  if has_prod_managing; then
    log "pivot déjà effectué : étapes kind sautées"
    return 0
  fi
  ensure_kind
  capi_init "$KIND_KUBECONFIG"
  capi_wait_controllers "$KIND_KUBECONFIG"
}

# --- 2. Manifests du cluster ---
step_apply() {
  has_prod_managing && return 0
  log "kubectl apply -k gitops/clusters/prod"
  retry 10 15 kkind apply --server-side --force-conflicts -k "${GITOPS_DIR}/clusters/prod"
}

step_wait_cluster() {
  has_prod_managing && return 0
  wait_for 1800 "Cluster ${CLUSTER_NAME} Provisioned" cluster_provisioned
  wait_for 1800 "control plane ${CLUSTER_NAME}-cp prêt" control_plane_ready
}

# --- 3. Accès (kubeconfig + talosconfig) ---
step_access() {
  if has_prod_managing; then
    log "accès : ${PROD_KUBECONFIG} (déjà présent)"
    return 0
  fi
  log "extraction kubeconfig -> ${PROD_KUBECONFIG}"
  (
    umask 077
    clusterctl get kubeconfig "$CLUSTER_NAME" -n "$CLUSTER_NS" --kubeconfig "$KIND_KUBECONFIG" >"${PROD_KUBECONFIG}.tmp"
    mv "${PROD_KUBECONFIG}.tmp" "$PROD_KUBECONFIG"
    log "extraction talosconfig -> ${PROD_TALOSCONFIG}"
    kkind -n "$CLUSTER_NS" get secret "${CLUSTER_NAME}-talosconfig" -o jsonpath='{.data.talosconfig}' \
      | base64 -d >"${PROD_TALOSCONFIG}.tmp"
    mv "${PROD_TALOSCONFIG}.tmp" "$PROD_TALOSCONFIG"
  )
  wait_for 600 "API du cluster cible joignable" kprod get --raw /readyz
}

# --- 4. cert-manager puis Cilium (mêmes versions/values que les Applications ArgoCD) ---
step_cni() {
  has_prod_managing && return 0
  # Sans CNI les nœuds sont NotReady : cert-manager ne peut pas démarrer avant Cilium,
  # donc --wait=false ici (surcharge le --wait du helper) et attente explicite après Cilium.
  helm_from_app cert-manager cert-manager cert-manager cert-manager --wait=false
  helm_from_app cilium cilium cilium kube-system
  wait_for 1200 "nœuds Ready" kprod wait --for=condition=Ready nodes --all --timeout=10s
  wait_for 900 "cert-manager disponible" \
    kprod -n cert-manager wait --for=condition=Available deployment --all --timeout=10s
}

# --- 5. Pivot ---
step_pivot() {
  if has_prod_managing; then
    log "pivot déjà effectué"
    return 0
  fi
  # Après le pivot, CAPMOX tourne en zone PROD : il joint l'API par l'IP mgmt de l'hôte (règle OPNsense M9 et
  # NetworkPolicy), jamais par proxmox_url, qui est l'adresse vue du poste opérateur (VPN, IP publique...).
  capi_init "$PROD_KUBECONFIG" "https://$(contract '.host.mgmt_ip'):$(contract '.flow_ports.proxmox_api')"
  capi_wait_controllers "$PROD_KUBECONFIG"
  log "clusterctl move : kind -> ${CLUSTER_NAME}"
  clusterctl move --kubeconfig "$KIND_KUBECONFIG" --to-kubeconfig "$PROD_KUBECONFIG" -n "$CLUSTER_NS"
}

# --- 6. Vérification puis suppression de kind ---
step_verify_cleanup() {
  has_prod_managing || die "le Cluster est absent du cluster cible : pivot non terminé, kind conservé"
  wait_for 900 "Cluster Provisioned dans la cible" cluster_phase_prod
  local n_machines
  n_machines=$(kprod -n "$CLUSTER_NS" get machines --no-headers 2>/dev/null | wc -l | tr -d ' ')
  ((n_machines > 0)) || die "aucune Machine dans le cluster cible après le pivot"
  log "${n_machines} Machine(s) gérée(s) par le cluster cible"
  if [[ -s "$KIND_KUBECONFIG" ]] && kkind -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" >/dev/null 2>&1; then
    die "le Cluster existe encore dans kind : pivot incomplet, kind conservé"
  fi
  if kind get clusters 2>/dev/null | grep -qx "$KIND_CLUSTER_NAME"; then
    log "suppression du cluster kind"
    kind delete cluster --name "$KIND_CLUSTER_NAME"
  fi
  rm -f "$KIND_KUBECONFIG"
}

step_kind
step_apply
step_wait_cluster
step_access
step_cni
step_pivot
step_verify_cleanup
log "cluster ${CLUSTER_NAME} prêt et auto-géré. kubeconfig : ${PROD_KUBECONFIG}  talosconfig : ${PROD_TALOSCONFIG}"
