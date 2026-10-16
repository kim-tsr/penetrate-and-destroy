#!/usr/bin/env bash
# Crée le cluster Kubernetes pad-prod : kind éphémère -> CAPI/CAPMOX/Talos -> CNI -> pivot -> suppression de kind.
# Idempotent et reprenable : chaque étape détecte son état et se saute si elle est déjà faite.
# Prérequis : sops (SOPS_AGE_KEY_FILE), secrets/proxmox.sops.yaml, gitops/platform/proxmox-csi/secret.sops.yaml (config du CCM),
# kind, docker, kubectl, helm, clusterctl, yq.
# shellcheck source=bootstrap/scripts/capi-common.sh
source "$(dirname "$0")/capi-common.sh"

require_cmd kind docker kubectl helm clusterctl yq sops base64

# Le cluster cible gère-t-il déjà son propre objet Cluster (pivot fait) ?
has_prod_managing() {
  [[ -s "$PROD_KUBECONFIG" ]] && has_cluster "$PROD_KUBECONFIG"
}

cluster_provisioned() { [[ "$(kkind -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" -o jsonpath='{.status.phase}')" == "Provisioned" ]]; }
# Contrat CAPI v1beta2 : status.ready n'est plus renseigné ; on lit la condition Ready (ancien champ gardé en repli).
control_plane_ready() {
  local st
  st=$(kkind -n "$CLUSTER_NS" get taloscontrolplane "${CLUSTER_NAME}-cp" \
    -o jsonpath='{.status.ready}{" "}{.status.conditions[?(@.type=="Ready")].status}')
  [[ "$st" == "true "* || "$st" == *" True" ]]
}
cluster_phase_prod() { [[ "$(kprod -n "$CLUSTER_NS" get cluster "$CLUSTER_NAME" -o jsonpath='{.status.phase}')" == "Provisioned" ]]; }

# Nœuds initialisés par le cloud controller manager : tous ont un providerID proxmox:// et plus aucun le taint
# node.cloudprovider.kubernetes.io/uninitialized (kubelets en cloud-provider=external, cf. gitops/clusters/prod).
nodes_initialized() {
  local lines
  lines=$(kprod get nodes -o jsonpath='{range .items[*]}{.spec.providerID}{"|"}{.spec.taints[*].key}{"\n"}{end}') || return 1
  [[ -n "$lines" ]] || return 1
  ! grep -qvE '^proxmox://[^|]+\|' <<<"$lines" && ! grep -q 'node.cloudprovider.kubernetes.io/uninitialized' <<<"$lines"
}

# Cloud controller manager Proxmox (gitops/platform/proxmox-ccm). Sa configuration est le Secret du CSI
# (proxmox-csi-config, même namespace, même jeton) : ksops n'existe pas encore, on le déchiffre ici avec sops et on
# l'applique par un pipe (jamais écrit en clair sur disque, jamais affiché). ArgoCD l'adopte ensuite (Application
# proxmox-csi), comme la release Helm (Application proxmox-ccm). Idempotent.
install_ccm() {
  local app="${PLATFORM_DIR}/proxmox-ccm/application.yaml" rel="gitops/platform/proxmox-csi/secret.sops.yaml"
  local sops_file="${ROOT_DIR}/${rel}" cfg ns secret_name meta provider placeholders
  # Contenu de la clé config.yaml du Secret (stringData, ou data en base64), lu sur l'entrée standard.
  cfg='.stringData."config.yaml" // (.data."config.yaml" | @base64d) // ""'
  ns=$(yq -e '.spec.destination.namespace' "$app")
  secret_name=$(yq -e '.existingConfigSecret' "$(values_of proxmox-ccm)")
  [[ -f "$sops_file" ]] || die "secret manquant : ${rel} ('task secrets:init' puis 'sops ${rel}', guide §2.3)"
  # Contrôles sans rien afficher de secret : seules des métadonnées, un nom de mode et un compteur sortent des pipes.
  meta=$(sops --decrypt "$sops_file" | yq -r '.kind + "/" + .metadata.namespace + "/" + .metadata.name') \
    || die "déchiffrement impossible : ${rel} (SOPS_AGE_KEY_FILE ?)"
  [[ "$meta" == "Secret/${ns}/${secret_name}" ]] || die "${rel} : attendu Secret/${ns}/${secret_name}, trouvé ${meta}"
  provider=$(sops --decrypt "$sops_file" | yq -r "$cfg" | yq -r '.features.provider // "default"') \
    || die "${rel} : clé config.yaml illisible"
  [[ "$provider" == capmox ]] || die "${rel} : features.provider vaut « ${provider} », il faut « capmox » (providerID proxmox://<uuid> attendu par CAPMOX) ; corriger avec 'sops ${rel}'"
  placeholders=$(sops --decrypt "$sops_file" | yq -r "$cfg" \
    | yq -r '[(.clusters // [])[] | select(.token_secret == "CHANGEME" or .token_id == "CHANGEME")] | length') \
    || die "${rel} : clé config.yaml illisible"
  [[ "$placeholders" == 0 ]] || die "${rel} : jeton encore à CHANGEME (token_secret de csi@pve, guide §2.3)"

  kprod get namespace "$ns" >/dev/null 2>&1 || kprod create namespace "$ns"
  log "Secret ${ns}/${secret_name} (déchiffré par sops, appliqué par un pipe)"
  sops --decrypt "$sops_file" \
    | kprod apply --server-side --force-conflicts --field-manager=pad-bootstrap -f - >/dev/null \
    || die "application du Secret ${ns}/${secret_name} impossible"
  helm_from_app proxmox-ccm proxmox-cloud-controller-manager proxmox-ccm "$ns"
}

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
  # CRDs Prometheus (ServiceMonitor, PodMonitor...) d'abord : les values de cert-manager et de Cilium en déclarent ;
  # sans elles, helm échoue (« no matches for kind ServiceMonitor »). Chart sans pod : pas besoin de CNI.
  helm_from_app prometheus-crds prometheus-operator-crds prometheus-crds "$(contract '.namespaces.monitoring_agents')"
  # startupapicheck = hook post-install que helm attend même avec --wait=false : sans CNI, son pod reste Pending et
  # l'installation expire. Désactivé ici : l'attente explicite de cert-manager après Cilium fait la même vérification.
  helm_from_app cert-manager cert-manager cert-manager cert-manager --wait=false --set startupapicheck.enabled=false
  helm_from_app cilium cilium cilium kube-system
  # Kubelets en cloud-provider=external : sans cloud controller manager, chaque nœud garde le taint
  # node.cloudprovider.kubernetes.io/uninitialized (rien ne s'y planifie, cert-manager reste Pending) et n'a pas de
  # providerID (les Machines CAPI restent Provisioned). Le CCM tolère ce taint, tourne sur le control plane et a besoin
  # du réseau des pods : juste après Cilium.
  install_ccm
  wait_for 1200 "nœuds Ready" kprod wait --for=condition=Ready nodes --all --timeout=10s
  wait_for 600 "nœuds initialisés par le CCM (providerID, plus de taint uninitialized)" nodes_initialized
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
