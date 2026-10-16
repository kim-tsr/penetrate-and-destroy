#!/usr/bin/env bash
# Vérification d'une phase du déploiement (LECTURE SEULE) : affiche OK / KO / WARN et, pour chaque KO, quoi regarder.
#
#   scripts/phase/check.sh <phase>          via `task check:<phase>` (ex. task check:4-lxc)
#   scripts/phase/check.sh list             liste les phases
#   scripts/phase/check.sh pre-gitops|pre-acces   préconditions humaines (tout poussé ? jetons créés ?)
#   scripts/phase/check.sh wait-opnsense    attend que l'API/GUI d'OPNsense réponde (entre 10-router et 60-opnsense-rules)
#
# Phases : 0-prereqs 1-reseau 2-routeur 3-image-talos 4-lxc 5-dns 6-services-1 7-identite 8-services-2 9-cluster
#          10-gitops 11-acces 12-verify   +   cluster-detruit, tout-detruit (contrôles après destruction)
#
# Variables : PAD_CHECK_MODE=warn (les KO ne font plus échouer la commande), PAD_PROXMOX_JUMP (rebond SSH, comme Ansible).
# Code retour : 0 si aucun KO, 1 sinon. Aucune valeur secrète n'est affichée.
# shellcheck disable=SC2015  # pass/fail/warn retournent toujours 0 : « A && pass || fail » est un if-else voulu
set -uo pipefail
# shellcheck source=scripts/phase/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PHASES=(0-prereqs 1-reseau 2-routeur 3-image-talos 4-lxc 5-dns 6-services-1 7-identite 8-services-2 9-cluster 10-gitops 11-acces 12-verify)

# Privilèges Proxmox indispensables au jeton de tofu et de CAPMOX (docs/guide-deploiement.md, « Jeton API »).
PVE_PRIVS_REQUIRED=(Datastore.Allocate Datastore.AllocateSpace Datastore.AllocateTemplate Datastore.Audit SDN.Use Sys.Audit Sys.Modify
  VM.Allocate VM.Audit VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory
  VM.Config.Network VM.Config.Options VM.Console VM.PowerMgmt)
# Absents sans gravité (avertissement seulement). VM.Monitor n'existe plus depuis Proxmox 9.
PVE_PRIVS_OPTIONAL=(VM.GuestAgent.Audit)

# Valeurs qui restent légitimement à CHANGEME tant que la phase indiquée n'a pas eu lieu (fichier|clé|phase).
LATER=(
  "secrets/netbird.sops.yaml|netbird_server_authentik_client_secret|7-identite"
  "secrets/warpgate.sops.yaml|warpgate_sso_client_secret|7-identite"
  "secrets/monitoring.sops.yaml|grafana_oidc_client_secret|7-identite"
  "gitops/apps/frontend/secret.sops.yaml|AUTH_AUTHENTIK_SECRET|7-identite"
  "gitops/platform/argocd/secret-oidc.sops.yaml|clientSecret|7-identite"
  "secrets/netbird-tofu.sops.yaml|api_token|11-acces"
  "secrets/netbird-agent.sops.yaml|netbird_agent_setup_key_challenges|11-acces"
  "secrets/netbird-agent.sops.yaml|netbird_agent_setup_key_bastion|11-acces"
  "secrets/warpgate-tofu.sops.yaml|api_token|11-acces"
  "gitops/apps/netbird-sync/secret.sops.yaml|NETBIRD_API_TOKEN|11-acces"
  "gitops/apps/frontend/secret.sops.yaml|NETBIRD_API_TOKEN|11-acces"
  "secrets/monitoring.sops.yaml|uptime_kuma_username|12-verify"
  "secrets/monitoring.sops.yaml|uptime_kuma_password|12-verify"
)

# later_phase <fichier> <clé> : phase après laquelle la valeur est attendue, ou vide si elle est requise dès maintenant.
later_phase() {
  local e f k p base=${2##*.}
  for e in "${LATER[@]}"; do
    IFS='|' read -r f k p <<<"$e"
    if [[ "$f" == "$1" && "$k" == "$base" ]]; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

# pending_report <phase> : CHANGEME restants. Bloquant si la valeur est attendue avant ou pendant <phase> ; sinon informatif.
pending_report() {
  local phase=$1 out line f keys k lp n_block=0 n_later=0 idx_phase idx_lp
  out=$(python3 "${ROOT_DIR}/scripts/sopsctl.py" pending 2>&1) || true
  if ! grep -q '^A RENSEIGNER' <<<"$out"; then
    if grep -q 'Plus aucune valeur CHANGEME' <<<"$out"; then
      pass "aucune valeur CHANGEME dans les secrets"
    else
      fail "task secrets:pending illisible : ${out%%$'\n'*}" "SOPS_AGE_KEY_FILE ? task secrets:init ?"
    fi
    return
  fi
  idx_phase=$(phase_index "$phase")
  while IFS= read -r line; do
    [[ "$line" == "A RENSEIGNER "* ]] || continue
    f=${line#A RENSEIGNER }
    f=${f%% :*}
    keys=${line#*" : "}
    keys=${keys%%   (sops*}
    IFS=',' read -ra arr <<<"$keys"
    for k in "${arr[@]}"; do
      k=${k# }
      lp=$(later_phase "$f" "$k") || lp=""
      if [[ -n "$lp" ]]; then
        idx_lp=$(phase_index "$lp")
        if ((idx_lp > idx_phase)); then
          n_later=$((n_later + 1))
          continue
        fi
      fi
      n_block=$((n_block + 1))
      fail "à renseigner : ${f} -> ${k}" "sops ${f}"
    done
  done <<<"$out"
  ((n_block > 0)) || pass "aucune valeur CHANGEME requise avant la fin de la phase ${phase}"
  ((n_later == 0)) || info "${n_later} valeur(s) restent à CHANGEME jusqu'à une phase ultérieure (normal : secrets OIDC, PAT NetBird/Warpgate...)"
}

phase_index() {
  local i
  for i in "${!PHASES[@]}"; do
    [[ "${PHASES[$i]}" == "$1" ]] && { echo "$i"; return; }
  done
  echo 99
}

# --- conteneurs d'un LXC -----------------------------------------------------------------------------------------------
# lxc_containers_ok <service> : tous les conteneurs Docker du LXC tournent, sans redémarrage en boucle ni unhealthy.
lxc_containers_ok() {
  local svc=$1 ip out bad n
  ip=$(svc_ip "$svc")
  if ! out=$(lxc_ssh "$ip" docker ps -a --format '{{.Names}}|{{.Status}}' 2>&1); then
    fail "${svc} (${ip}) : docker ps impossible (${out%%$'\n'*})" "ssh -J <hôte> root@${ip} ; le LXC tourne-t-il ? Ansible est-il passé ? (task ansible:services)"
    return
  fi
  n=$(grep -c . <<<"$out" || true)
  bad=$(grep -E 'Restarting|unhealthy|Exited|Dead|Created' <<<"$out" | cut -d'|' -f1 | tr '\n' ' ')
  if ((n == 0)); then
    fail "${svc} : aucun conteneur Docker" "task ansible:services -- --tags ${svc} --limit ${svc}"
  elif [[ -n "$bad" ]]; then
    fail "${svc} : conteneur(s) en défaut : ${bad}" "ssh -J <hôte> root@${ip} docker logs <conteneur> ; docker compose --project-directory /opt/pad/${svc} ps"
  else
    pass "${svc} : ${n} conteneur(s) Docker sains"
  fi
}

# http_code <url> [options curl] : code HTTP (000 si injoignable)
http_code() {
  local url=$1
  shift
  curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null || true
}

# https_valid <fqdn> <chemin> <codes attendus (regex)> : certificat valide ET code attendu
https_valid() {
  local url="https://$1$2" out code verify
  out=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{ssl_verify_result}' "$url" 2>/dev/null) || out="000 -1"
  code=${out%% *}
  verify=${out##* }
  if [[ "$code" =~ ^($3)$ && "$verify" == 0 ]]; then
    pass "${url} -> HTTP ${code}, certificat valide"
  elif [[ "$code" =~ ^($3)$ ]]; then
    fail "${url} répond HTTP ${code} mais le certificat n'est pas valide (ssl_verify_result=${verify})" "journaux Traefik de l'edge : ACME DNS-01 OVH réussi ? (docker logs sur le LXC edge)"
  else
    fail "${url} -> HTTP ${code} (attendu : $3)" "DNS (phase 5), DNAT/OPNsense (phase 2), conteneurs du LXC (task check:6-services-1)"
  fi
}

# opn_get <chemin> : appel GET de l'API OPNsense, depuis l'hôte Proxmox (zone mgmt), identifiants par stdin (pas dans argv).
opn_get() {
  local key sec gw
  key=$(sops --decrypt --extract '["api_key"]' "${ROOT_DIR}/secrets/opnsense.sops.yaml" 2>/dev/null) || return 1
  sec=$(sops --decrypt --extract '["api_secret"]' "${ROOT_DIR}/secrets/opnsense.sops.yaml" 2>/dev/null) || return 1
  gw=$(c '.zones.mgmt.gw')
  printf 'user = "%s:%s"\n' "$key" "$sec" | host_ssh curl -ksS --max-time 15 --config - "https://${gw}$1"
}

route_ok() {
  local gw probe out
  gw=$(c '.zones.mgmt.gw')
  probe=$(c '.kubernetes.control_plane_endpoint')
  out=$(host_ssh ip route get "$probe" 2>/dev/null) || out=""
  if grep -q "via ${gw}" <<<"$out"; then
    pass "l'hôte route 10.20.0.0/16 vers les zones via ${gw}"
  else
    fail "l'hôte n'a pas de route vers les zones via ${gw} (réponses de CAPMOX/CSI, rebond SSH vers les LXC)" \
      "task host:route (rôle host-tuning, tag host_route : pose la route et la rend permanente) ; à la main sur l'hôte : ip route replace $(c '.zones.mgmt.cidr' | cut -d. -f1-2).0.0/16 via ${gw} dev $(c '.host.zones_bridge').$(c '.zones.mgmt.vlan')"
  fi
}

# ======================================================================================================================
c_0_prereqs() {
  section "Outils du poste opérateur"
  local t miss=()
  for t in task tofu ansible-playbook ansible-galaxy sops age-keygen yq jq kubectl helm clusterctl kind talosctl python3 ssh curl openssl; do
    have "$t" || miss+=("$t")
  done
  if ((${#miss[@]})); then
    fail "outils manquants : ${miss[*]}" "entrer dans le shell Nix : nix develop (docs/guide-deploiement.md, §1)"
  else
    pass "outils présents (task, tofu, ansible, sops, age, kubectl, helm, clusterctl, kind, talosctl...)"
  fi
  if have tofu; then
    local v
    v=$(tofu version 2>/dev/null | head -n1 | sed -E 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/')
    if [[ -n "$v" ]] && [[ "$(printf '%s\n1.10\n' "$v" | sort -V | head -n1)" == 1.10 ]]; then pass "OpenTofu ${v} (>= 1.10)"; else fail "OpenTofu ${v:-inconnu} < 1.10" "nix develop"; fi
  fi
  if have kind; then
    local want have_k
    want=$(c '.kubernetes.kind_version')
    have_k=$(kind version 2>/dev/null | awk '{print $2}')
    [[ "$have_k" == "$want" ]] && pass "kind ${have_k} (version du contrat)" || fail "kind ${have_k:-absent}, le contrat exige ${want}" "nix develop"
  fi
  if have docker && docker info >/dev/null 2>&1; then
    pass "démon Docker joignable (kind en a besoin)"
  else
    fail "démon Docker injoignable" "démarrer Docker (systemctl start docker) ; votre utilisateur est-il dans le groupe docker ?"
  fi
  if have xorriso || have mkisofs || have genisoimage || have nix; then
    pass "outil de création d'ISO (OPNsense) : présent"
  else
    fail "ni xorriso, ni mkisofs, ni genisoimage, ni nix" "installer xorriso (phase 2 construit un ISO de configuration OPNsense)"
  fi

  section "Clés et variables d'environnement"
  if [[ -n "${SOPS_AGE_KEY_FILE:-}" && -r "${SOPS_AGE_KEY_FILE}" ]] && age-keygen -y "$SOPS_AGE_KEY_FILE" >/dev/null 2>&1; then
    pass "clé age de l'opérateur lisible (SOPS_AGE_KEY_FILE)"
  else
    fail "SOPS_AGE_KEY_FILE absent ou clé illisible" "task secrets:keys ; export SOPS_AGE_KEY_FILE=\$HOME/.config/sops/age/keys.txt"
  fi
  local ck="${PAD_CLUSTER_AGE_KEY_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/pad/cluster.agekey}"
  if [[ -r "$ck" ]] && age-keygen -y "$ck" >/dev/null 2>&1; then
    pass "clé age du cluster lisible (${ck/#$HOME/~})"
    grep -q "$(age-keygen -y "$ck")" "${ROOT_DIR}/.sops.yaml" && pass "la clé du cluster est recipient dans .sops.yaml" \
      || fail "la clé publique du cluster n'est pas dans .sops.yaml" "task secrets:keys puis task secrets:update-keys"
  else
    fail "clé age du cluster illisible (${ck/#$HOME/~})" "task secrets:keys (ou PAD_CLUSTER_AGE_KEY_FILE)"
  fi
  if grep -qE '^[[:space:]]*-[[:space:]]*&[A-Za-z0-9_]+[[:space:]]+age1CHANGEME' "${ROOT_DIR}/.sops.yaml"; then fail ".sops.yaml contient encore CHANGEME (recipients)" "task secrets:keys"; else pass ".sops.yaml : recipients renseignés"; fi
  local pp=${TF_VAR_state_passphrase:-} pass_len
  pass_len=${#pp}
  if ((pass_len >= 16)); then
    pass "TF_VAR_state_passphrase défini (chiffrement des states tofu)"
  else
    fail "TF_VAR_state_passphrase absent ou trop court (< 16 caractères)" "export TF_VAR_state_passphrase=\"\$(cat ~/.config/pad/state.pass)\" (voir guide, §4)"
  fi
  if have ssh-add && ssh-add -l >/dev/null 2>&1; then
    pass "agent SSH avec au moins une clé chargée (le provider bpg/proxmox s'en sert en phase 2)"
  else
    fail "aucune clé dans l'agent SSH" "eval \"\$(ssh-agent)\" ; ssh-add ~/.ssh/<votre clé>"
  fi

  section "Contrat et dépôt"
  local d
  d=$(c '.domain')
  if [[ "$d" == *CHANGEME* || "$d" == *example.net ]]; then
    fail "domain vaut encore ${d} dans infra/contracts.yaml" "remplacer le domaine partout (guide, §6) puis commiter dans VOTRE dépôt"
  else
    pass "domaine du contrat : renseigné"
  fi
  [[ "$(c '.acme.email')" == *CHANGEME* ]] && fail "acme.email vaut encore CHANGEME" "infra/contracts.yaml" || pass "acme.email renseigné"
  local origin
  origin=$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || echo "")
  if [[ -n "$origin" && "$origin" != "$(c '.git.repo')" && "$origin" != "$(c '.git.ssh')" ]]; then
    warn "git.repo du contrat diffère de 'origin' : ArgoCD suivra git.repo, pas origin" "aligner infra/contracts.yaml (git.repo, git.ssh) et les manifests marqués '# contracts: git.repo'"
  fi

  section "Secrets"
  local ex sops n_missing=0
  for ex in "${ROOT_DIR}"/secrets/*.example.yaml; do
    [[ "$ex" == *backup-s3* ]] && continue
    sops="${ex%.example.yaml}.sops.yaml"
    [[ -f "$sops" ]] || { fail "$(basename "$sops") manquant" "task secrets:init"; n_missing=$((n_missing + 1)); }
  done
  ((n_missing > 0)) || pass "chaque secrets/*.example.yaml a son *.sops.yaml"
  if bash "${ROOT_DIR}/scripts/check-sops.sh" >/dev/null 2>&1; then pass "garde-fou structurel des secrets (check-sops.sh)"; else fail "scripts/check-sops.sh échoue" "bash scripts/check-sops.sh"; fi
  pending_report 0-prereqs

  section "Hôte Proxmox : SSH et API (lecture seule)"
  local ssh_t
  if ssh_t=$(host_target); then
    if host_ssh true 2>/dev/null; then pass "SSH vers l'hôte (${ssh_t##*@}) sans mot de passe"; else fail "SSH vers l'hôte impossible" "ssh ${ssh_t} true ; clé dans l'agent ? ssh_host/ssh_user de secrets/site.sops.yaml ?"; fi
    if host_ssh sudo -n true 2>/dev/null; then pass "sudo sans mot de passe pour ${ssh_t%%@*}"; else fail "sudo sans mot de passe indisponible pour ${ssh_t%%@*}" "ligne NOPASSWD dans /etc/sudoers.d/pad sur l'hôte (guide, §2)"; fi
  else
    fail "secrets/site.sops.yaml illisible ou ssh_host/ssh_user vides" "sops secrets/site.sops.yaml"
  fi
  local ver
  if ver=$(pve_get /version 2>/dev/null | jq -r '.data.version'); then
    [[ "$ver" == 9.* ]] && pass "API Proxmox joignable, version ${ver}" || warn "Proxmox ${ver} : le dépôt vise la 9.x" "tester une version différente à vos risques"
    pve_get /nodes | jq -e --arg n "$(node)" '.data[] | select(.node==$n)' >/dev/null 2>&1 \
      && pass "nœud Proxmox « $(node) » présent (host.node)" || fail "nœud « $(node) » introuvable" "task site:node -- <nom exact du nœud>"
    check_privileges
    check_storage
  else
    fail "API Proxmox injoignable ou jeton refusé" "proxmox_url (site.sops.yaml), api_token (proxmox.sops.yaml), pare-feu du port 8006 ; curl -k <url>/api2/json/version"
  fi
}

check_privileges() {
  local perms miss=() opt=() p
  perms=$(pve_get /access/permissions 2>/dev/null) || { warn "permissions du jeton non lisibles" "pveum user permissions"; return; }
  if ! jq -e '.data["/"]' <<<"$perms" >/dev/null 2>&1; then
    warn "aucune permission posée à la racine « / » pour ce jeton" "pveum acl modify / --tokens '<user>!<jeton>' --roles <rôle> (guide, §2), ou ACL sur des chemins plus fins : à vérifier à la main"
    return
  fi
  for p in "${PVE_PRIVS_REQUIRED[@]}"; do jq -e --arg p "$p" '.data["/"][$p] == 1' <<<"$perms" >/dev/null 2>&1 || miss+=("$p"); done
  for p in "${PVE_PRIVS_OPTIONAL[@]}"; do jq -e --arg p "$p" '.data["/"][$p] == 1' <<<"$perms" >/dev/null 2>&1 || opt+=("$p"); done
  if ((${#miss[@]})); then
    fail "privilèges manquants au jeton sur « / » : ${miss[*]}" "pveum role modify <rôle> --privs ... (liste exacte dans le guide, §2)"
  else
    pass "le jeton a les privilèges requis sur « / »"
  fi
  ((${#opt[@]} == 0)) || warn "privilèges facultatifs absents : ${opt[*]}" "inutile si Proxmox refuse de les créer (selon la version)"
}

check_storage() {
  local st dsv dsi row content
  st=$(pve_get "/nodes/$(node)/storage" 2>/dev/null) || { fail "stockages non lisibles" "droit Datastore.Audit"; return; }
  dsv=$(c '.host.datastore_vm')
  dsi=$(c '.host.datastore_iso')
  row=$(jq -c --arg s "$dsv" '.data[] | select(.storage==$s)' <<<"$st")
  if [[ -z "$row" ]]; then
    fail "stockage des disques « ${dsv} » introuvable" "pvesm status ; host.datastore_vm du contrat"
  else
    content=$(jq -r '.content' <<<"$row")
    [[ "$content" == *images* && "$content" == *rootdir* ]] && pass "stockage ${dsv} : type $(jq -r '.type' <<<"$row"), contenu ${content}" \
      || fail "stockage ${dsv} : contenu « ${content} » sans images et rootdir" "pvesm set ${dsv} --content images,rootdir"
    [[ "$(jq -r '.type' <<<"$row")" == "$(c '.host.datastore_vm_type')" ]] \
      && pass "type de stockage ${dsv} conforme au contrat (host.datastore_vm_type)" \
      || fail "${dsv} est de type $(jq -r '.type' <<<"$row"), le contrat dit $(c '.host.datastore_vm_type')" "task site:set -- datastore_vm_type=$(jq -r '.type' <<<"$row")"
    check_space "$(jq -r '.avail' <<<"$row")"
  fi
  row=$(jq -c --arg s "$dsi" '.data[] | select(.storage==$s)' <<<"$st")
  if [[ -z "$row" ]]; then
    fail "stockage « ${dsi} » (ISO, templates) introuvable" "host.datastore_iso du contrat"
  else
    content=$(jq -r '.content' <<<"$row")
    local missing=()
    for t in iso vztmpl; do [[ ",${content}," == *",${t},"* ]] || missing+=("$t"); done
    if ((${#missing[@]})); then
      fail "stockage ${dsi} : types de contenu manquants : ${missing[*]} (actuel : ${content})" "sur l'hôte : pvesm set ${dsi} --content ${content},${missing[*]// /,}"
    else
      pass "stockage ${dsi} : contenu iso, vztmpl présents"
    fi
    # « import » (phase 3) est posé automatiquement par le rôle host-tuning en phase 1 : simple avertissement avant.
    [[ ",${content}," == *",import,"* ]] && pass "stockage ${dsi} : contenu import présent" \
      || warn "stockage ${dsi} : contenu import absent (actuel : ${content})" "posé par la phase 1 (rôle host-tuning, tag host_iso_import : task ansible:host)"
  fi
  local mem need
  mem=$(pve_get "/nodes/$(node)/status" 2>/dev/null | jq -r '.data.memory.total // 0')
  need=$(yq '.router.memory_mb, .services[].memory_mb, .kubernetes.control_plane.memory_mb, .kubernetes.pools.platform.memory_mb * .kubernetes.pools.platform.replicas, .kubernetes.pools.challenges.memory_mb * .kubernetes.pools.challenges.min' "$CONTRACTS" | awk '{s+=$1} END {print s+0}')
  if ((mem > 0)); then
    if ((mem / 1048576 < need + $(c '.host.zfs_arc_max_bytes') / 1048576)); then
      warn "RAM de l'hôte $((mem / 1073741824)) Gio, minimum de la plateforme ≈ $(((need + 4096) / 1024)) Gio (invités + ARC)" "réduire replicas/memory_mb dans infra/contracts.yaml"
    else
      pass "RAM de l'hôte suffisante pour le minimum de la plateforme (≈ $((need / 1024)) Gio d'invités)"
    fi
  fi
}

check_space() {
  local avail=$1 need
  need=$(yq '.router.disk_gb, .services[].disk_gb, .kubernetes.control_plane.disk_gb, .kubernetes.pools.platform.disk_gb * .kubernetes.pools.platform.replicas, .kubernetes.pools.challenges.disk_gb * .kubernetes.pools.challenges.min' "$CONTRACTS" | awk '{s+=$1} END {print s+0}')
  if ((avail / 1073741824 < need + 40)); then
    warn "espace libre $((avail / 1073741824)) Gio sur $(c '.host.datastore_vm'), besoin ≈ $((need + 40)) Gio (invités au minimum + template + volumes)" "libérer de l'espace ou réduire disk_gb"
  else
    pass "espace libre suffisant sur $(c '.host.datastore_vm') ($((avail / 1073741824)) Gio libres)"
  fi
}

# ======================================================================================================================
c_1_reseau() {
  section "Stack 00-host-network"
  stack_has_state 00-host-network && pass "state tofu présent (.state/tofu/00-host-network.tfstate)" \
    || fail "pas de state pour 00-host-network" "task phase:1-reseau"
  local net zb vlan
  zb=$(c '.host.zones_bridge')
  vlan="${zb}.$(c '.zones.mgmt.vlan')"
  if net=$(pve_get "/nodes/$(node)/network" 2>/dev/null); then
    if jq -e --arg b "$zb" '.data[] | select(.iface==$b and .active==1 and (.bridge_vlan_aware==1))' <<<"$net" >/dev/null; then
      pass "bridge ${zb} actif et VLAN-aware"
    else
      fail "bridge ${zb} absent, inactif ou non VLAN-aware" "Proxmox > Réseau : configuration en attente (Appliquer) ? ifreload -a sur l'hôte"
    fi
    if jq -e --arg b "$vlan" '.data[] | select(.iface==$b and .active==1)' <<<"$net" >/dev/null; then
      pass "interface ${vlan} active (IP de l'hôte en zone mgmt, $(c '.host.mgmt_ip'))"
    else
      fail "interface ${vlan} absente ou inactive" "ip -br addr show ${vlan} sur l'hôte"
    fi
    if [[ "$(c '.wan.mode')" == nat ]]; then
      jq -e --arg b "$(c '.host.transit_bridge')" '.data[] | select(.iface==$b and .active==1)' <<<"$net" >/dev/null \
        && pass "bridge de transit $(c '.host.transit_bridge') actif (wan.mode = nat)" || fail "bridge de transit $(c '.host.transit_bridge') absent" "wan.mode = nat l'exige"
    fi
  else
    fail "API Proxmox injoignable" "task check:0-prereqs"
  fi
  section "Réglages de l'hôte (task ansible:host)"
  local arc want
  want=$(c '.host.zfs_arc_max_bytes')
  if host_ssh test -e /sys/module/zfs/parameters/zfs_arc_max 2>/dev/null; then
    arc=$(host_ssh cat /sys/module/zfs/parameters/zfs_arc_max 2>/dev/null || echo "")
    [[ "$arc" == "$want" ]] && pass "ARC ZFS plafonné à ${want} octets" || fail "zfs_arc_max = ${arc:-illisible}, attendu ${want}" "task ansible:host (idempotent) ; un redémarrage n'est pas requis, le paramètre est appliqué à chaud"
  else
    info "ZFS non chargé sur l'hôte : plafond de l'ARC sans objet"
  fi
  local port
  port=$(c '.monitoring.exporters.node')
  host_ssh "ss -ltn | grep -q ':${port} '" 2>/dev/null && pass "node-exporter écoute sur le port ${port}" || fail "rien n'écoute sur le port ${port} de l'hôte" "systemctl status prometheus-node-exporter ; task ansible:host"
  if [[ "$(c '.wan.mode')" == nat ]]; then
    host_ssh systemctl is-active pad-nat >/dev/null 2>&1 && pass "pad-nat (DNAT de repli) actif" || fail "unité pad-nat inactive (wan.mode = nat)" "systemctl status pad-nat ; nft list table ip pad_nat"
  fi
}

# ======================================================================================================================
c_2_routeur() {
  section "Stack 10-router (VM OPNsense)"
  stack_has_state 10-router && pass "state tofu présent" || fail "pas de state pour 10-router" "task phase:2-routeur"
  local vmid st gw
  vmid=$(c '.router.vmid')
  gw=$(c '.zones.mgmt.gw')
  st=$(vm_status "$vmid" qemu)
  [[ "$st" == running ]] && pass "VM ${vmid} ($(c '.router.name')) en cours d'exécution" || fail "VM ${vmid} : état « ${st:-absente} »" "qm list ; qm start ${vmid} ; console : qm terminal ${vmid}"
  if host_ssh ping -c1 -W2 "$gw" >/dev/null 2>&1; then
    pass "OPNsense répond au ping sur ${gw} depuis l'hôte"
  else
    fail "${gw} ne répond pas depuis l'hôte" "l'import de config.xml a-t-il eu lieu ? procédure manuelle de 1 minute : infra/opnsense/README.md ; console qm terminal ${vmid}"
  fi
  local code
  code=$(host_ssh curl -ksS --max-time 8 -o /dev/null -w '%{http_code}' "https://${gw}/" 2>/dev/null || echo 000)
  [[ "$code" =~ ^(200|301|302|303)$ ]] && pass "GUI OPNsense joignable (HTTP ${code}) depuis l'hôte" || fail "GUI OPNsense : HTTP ${code}" "config importée ? interface LAN = zone mgmt ?"
  route_ok
  local out
  if out=$(opn_get /api/core/firmware/status 2>/dev/null) && jq -e . >/dev/null 2>&1 <<<"$out"; then
    pass "API OPNsense authentifiée (clé api_key de secrets/opnsense.sops.yaml acceptée)"
  else
    fail "API OPNsense : réponse inattendue ou authentification refusée" "api_key/api_secret de secrets/opnsense.sops.yaml = ceux du config.xml importé ? (si OPNsense a démarré en config d'usine : réimporter, voir infra/opnsense/README.md)"
  fi

  section "Stack 60-opnsense-rules (règles de pare-feu)"
  stack_has_state 60-opnsense-rules && pass "state tofu présent" || fail "pas de state pour 60-opnsense-rules" "task phase:2-routeur (ou task tofu:apply-stack STACK=60-opnsense-rules)"
  if out=$(opn_get '/api/firewall/filter/search_rule?current=1&rowCount=1' 2>/dev/null) && jq -e '.total' >/dev/null 2>&1 <<<"$out"; then
    local total
    total=$(jq -r '.total' <<<"$out")
    ((total > 10)) && pass "${total} règles de pare-feu « automation » présentes" || fail "seulement ${total} règle(s) de pare-feu" "task plan:60-opnsense-rules ; Firewall > Automation > Filter dans l'UI"
  else
    warn "liste des règles non lisible par l'API (route d'API différente selon la version d'OPNsense)" "UI OPNsense > Pare-feu > Automatisation > Filtre : règles « Mxx / Ixx » attendues"
  fi
  # Split-DNS : les noms publics servis par l'edge doivent résoudre vers l'IP interne de l'edge depuis les zones.
  local edge_ip h
  edge_ip=$(c '.services.edge.ip')
  if out=$(opn_get '/api/unbound/settings/searchHostOverride' 2>/dev/null) && jq -e '.rows' >/dev/null 2>&1 <<<"$out"; then
    for h in $(c '.public_hostnames[]'); do
      jq -e --arg n "$(c ".hostnames.${h}")" --arg d "$(c '.domain')" --arg ip "$edge_ip" '.rows[] | select(.hostname==$n and .domain==$d and .server==$ip)' >/dev/null <<<"$out" \
        && pass "split-DNS : $(fqdn "$h") -> ${edge_ip} (edge, IP interne)" \
        || fail "split-DNS : override Unbound de $(fqdn "$h") absent ou différent de ${edge_ip}" "task tofu:apply-stack STACK=60-opnsense-rules ; Services > Unbound DNS > Overrides"
    done
  else
    warn "overrides Unbound non lisibles par l'API" "UI OPNsense > Services > Unbound DNS > Overrides : $(c '.public_hostnames | join(", ")') vers ${edge_ip}"
  fi
}

c_3_image_talos() {
  section "Stack 15-talos-image (template VM Talos)"
  stack_has_state 15-talos-image && pass "state tofu présent" || fail "pas de state pour 15-talos-image" "task phase:3-image-talos"
  local want_id cfg lo hi
  want_id=$(c '.kubernetes.talos_template.vmid')
  lo=$(c '.kubernetes.vmid_range[0]')
  hi=$(c '.kubernetes.vmid_range[1]')
  ((want_id >= lo && want_id <= hi)) && fail "le VMID du template (${want_id}) est dans la plage allouable par CAPMOX (${lo}-${hi})" "kubernetes.talos_template.vmid doit être hors de kubernetes.vmid_range"
  if cfg=$(pve_get "/nodes/$(node)/qemu/${want_id}/config" 2>/dev/null); then
    [[ "$(jq -r '.data.template // 0' <<<"$cfg")" == 1 ]] && pass "VM ${want_id} existe et est un template ($(jq -r '.data.name' <<<"$cfg"))" || fail "VM ${want_id} existe mais n'est pas un template" "qm template ${want_id}"
  else
    fail "template VM ${want_id} introuvable" "qm list ; task phase:3-image-talos"
  fi
  local sch
  sch=$(c '.kubernetes.talos_schematic_id')
  [[ -n "$sch" ]] && info "schematic Image Factory du contrat : ${sch:0:12}… (qemu-guest-agent)"
}

c_4_lxc() {
  section "Stack 20-services-lxc (LXC du contrat)"
  stack_has_state 20-services-lxc && pass "state tofu présent" || fail "pas de state pour 20-services-lxc" "task phase:4-lxc"
  [[ -s "${ROOT_DIR}/infra/ansible/inventories/prod/hosts.generated.yml" ]] && pass "inventaire Ansible généré (hosts.generated.yml)" || fail "hosts.generated.yml absent" "il est écrit par la stack 20-services-lxc"
  local s id st ip
  for s in $(yq -r '.services | keys | .[]' "$CONTRACTS"); do
    id=$(svc_vmid "$s")
    ip=$(svc_ip "$s")
    st=$(vm_status "$id" lxc)
    if [[ "$st" == running ]]; then
      host_ssh "sudo -n pct config ${id}" 2>/dev/null | grep -Eq '^features:.*keyctl=1' \
        || fail "LXC ${id} ${s} : feature keyctl absente (Docker échouera)" "task host:lxc-features (le jeton API ne peut pas poser keyctl : root@pam seulement)"
      if lxc_ssh "$ip" true 2>/dev/null; then
        pass "LXC ${id} ${s} : running, SSH root OK par rebond (${ip})"
      else
        fail "LXC ${id} ${s} : running mais SSH injoignable (${ip})" "route de l'hôte vers les zones (task check:2-routeur) ; OPNsense up ? pct enter ${id} ; ssh -J <hôte> root@${ip}"
      fi
    else
      fail "LXC ${id} ${s} : état « ${st:-absent} »" "pct list ; pct start ${id}"
    fi
  done
}

c_5_dns() {
  section "Stack 70-dns (enregistrements A publics)"
  stack_has_state 70-dns && pass "state tofu présent" || fail "pas de state pour 70-dns" "task phase:5-dns"
  local wan h name got
  wan=$(site_get wan.ip)
  [[ -n "$wan" ]] || { fail "wan.ip vide dans secrets/site.sops.yaml" "sops secrets/site.sops.yaml"; return; }
  for h in front auth vpn status; do
    name=$(fqdn "$h")
    if have dig; then got=$(dig +short +time=3 +tries=1 "$name" A 2>/dev/null | tail -n1); else got=$(getent hosts "$name" 2>/dev/null | awk '{print $1; exit}'); fi
    [[ "$got" == "$wan" ]] && pass "${name} -> ${wan}" || fail "${name} résout « ${got:-rien} », attendu l'IP WAN" "propagation (TTL 300 s) ; zone OVH : dig +short ${name} @<serveur DNS de la zone>"
  done
  info "les noms internes (bastion, grafana, argocd...) ne sont jamais publiés : normal qu'ils ne résolvent pas"
}

c_6_services_1() {
  section "Services LXC, passe 1 : monitoring, authentik, edge"
  local s
  for s in monitoring authentik edge; do lxc_containers_ok "$s"; done
  local code
  code=$(host_ssh curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "http://$(svc_ip monitoring):$(c '.ports.monitoring.victoriametrics')/health" 2>/dev/null || echo 000)
  [[ "$code" == 200 ]] && pass "VictoriaMetrics répond (health 200)" || fail "VictoriaMetrics : HTTP ${code}" "docker logs sur le LXC monitoring"
  https_valid "$(fqdn auth)" "/-/health/live/" "200|204"
  https_valid "$(fqdn front)" "/" "200|301|302|307|308|404|502|503"
  info "le front n'existe pas encore (cluster) : un 404/502/503 de l'edge suffit à prouver que Traefik sert un certificat valide"
}

c_7_identite() {
  section "Stack 30-authentik et secrets OIDC"
  stack_has_state 30-authentik && pass "state tofu présent" || fail "pas de state pour 30-authentik" "task phase:7-identite"
  local cl cid code
  for cl in $(yq -r '.identity.oidc_clients | keys | .[]' "$CONTRACTS"); do
    cid=$(c ".identity.oidc_clients.${cl}")
    code=$(http_code "https://$(fqdn auth)/application/o/${cid}/.well-known/openid-configuration")
    [[ "$code" == 200 ]] && pass "client OIDC ${cid} : découverte OIDC OK" || fail "client OIDC ${cid} : HTTP ${code}" "Authentik > Applications ; journaux de tofu 30-authentik"
  done
  pending_report 7-identite
  if ! git -C "$ROOT_DIR" diff --quiet -- secrets gitops 2>/dev/null; then
    warn "des secrets sont modifiés et non commités (sorties de task secrets:oidc-sync)" "git add secrets gitops && git commit -m 'chore(secrets): secrets OIDC' ; à pousser AVANT la phase 10 (ArgoCD lit le dépôt distant)"
  fi
}

c_8_services_2() {
  section "Services LXC, passe 2 : warpgate, netbird (+ monitoring rejoué)"
  local s
  for s in warpgate netbird monitoring; do lxc_containers_ok "$s"; done
  https_valid "$(fqdn vpn)" "/" "200|301|302"
  local code
  code=$(lxc_ssh "$(svc_ip warpgate)" curl -ksS --max-time 8 -o /dev/null -w '%{http_code}' "https://localhost:$(c '.ports.warpgate.https')/" 2>/dev/null || echo 000)
  [[ "$code" =~ ^(200|301|302|303|401)$ ]] && pass "Warpgate répond en local (HTTP ${code})" || fail "Warpgate : HTTP ${code}" "docker logs sur le LXC warpgate (SSO : warpgate_sso_client_secret renseigné ?)"
  code=$(lxc_ssh "$(svc_ip netbird)" curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "https://$(fqdn auth)/application/o/$(c '.identity.oidc_clients.netbird')/.well-known/openid-configuration" 2>/dev/null || echo 000)
  [[ "$code" == 200 ]] && pass "le LXC netbird atteint la découverte OIDC d'Authentik (rétro-canal)" \
    || fail "le LXC netbird n'atteint pas https://$(fqdn auth)/… (HTTP ${code})" "résolution/hairpin depuis la zone DMZ : override Unbound auth.<domaine> -> edge ($(svc_ip edge)) dans OPNsense, voir guide §phase 8"
}

c_9_cluster() {
  section "Cluster Kubernetes ($(c '.kubernetes.cluster_name'))"
  [[ -s "$PROD_KUBECONFIG" ]] && pass "kubeconfig présent (.state/kubeconfig)" || { fail "kubeconfig absent" "task phase:9-cluster ; task bootstrap:kubeconfig"; return; }
  [[ -s "$PROD_TALOSCONFIG" ]] && pass "talosconfig présent (.state/talosconfig)" || fail "talosconfig absent" "task bootstrap:kubeconfig"
  if ! kprod get --raw /readyz >/dev/null 2>&1; then
    fail "API Kubernetes injoignable ($(c '.kubernetes.control_plane_endpoint'):6443)" "route du poste vers 10.20.60.0/24 (guide, §1 « accès réseau ») ; talosctl health ; VMs allumées : qm list"
    return
  fi
  pass "API Kubernetes prête (/readyz)"
  local total notready want
  total=$(kprod get nodes --no-headers 2>/dev/null | grep -c . || true)
  notready=$(kprod get nodes --no-headers 2>/dev/null | grep -vc ' Ready' || true)
  want=$(yq '.kubernetes.control_plane.replicas + .kubernetes.pools.platform.replicas + .kubernetes.pools.challenges.min' "$CONTRACTS")
  ((notready == 0 && total >= want)) && pass "${total} nœud(s) Ready (minimum attendu : ${want})" || fail "${total} nœud(s) dont ${notready} non Ready (minimum attendu : ${want})" "kubectl get nodes -o wide ; kubectl describe node <nœud> ; talosctl -n <ip> dmesg"
  local phase
  phase=$(kprod -n "$(c '.kubernetes.capi_namespace')" get cluster "$(c '.kubernetes.cluster_name')" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
  [[ "$phase" == Provisioned ]] && pass "objet Cluster géré dans pad-prod lui-même (pivot fait), phase Provisioned" || fail "Cluster CAPI : phase « ${phase:-absent} » dans pad-prod" "le pivot (clusterctl move) a-t-il eu lieu ? kubectl -n $(c '.kubernetes.capi_namespace') get cluster,machines"
  if have kind && kind get clusters 2>/dev/null | grep -qx pad-bootstrap; then
    warn "le cluster kind « pad-bootstrap » existe encore" "normal tant que le pivot n'est pas terminé ; sinon : kind delete cluster --name pad-bootstrap"
  else
    pass "plus de cluster kind de bootstrap"
  fi
  if kprod -n kube-system get ds cilium >/dev/null 2>&1; then
    local d r
    d=$(kprod -n kube-system get ds cilium -o jsonpath='{.status.desiredNumberScheduled}')
    r=$(kprod -n kube-system get ds cilium -o jsonpath='{.status.numberReady}')
    [[ "$d" == "$r" ]] && pass "Cilium prêt sur ${r}/${d} nœud(s)" || fail "Cilium prêt sur ${r}/${d} nœud(s)" "kubectl -n kube-system logs ds/cilium ; cilium status"
  fi
  if have talosctl; then
    talosctl --talosconfig "$PROD_TALOSCONFIG" -e "$(c '.kubernetes.control_plane_endpoint')" -n "$(c '.kubernetes.control_plane_endpoint')" health --wait-timeout 60s >/dev/null 2>&1 \
      && pass "talosctl health : OK" || warn "talosctl health n'est pas OK (ou injoignable d'ici)" "talosctl --talosconfig .state/talosconfig -e $(c '.kubernetes.control_plane_endpoint') -n $(c '.kubernetes.control_plane_endpoint') health"
  fi
  local lo hi n
  lo=$(c '.kubernetes.vmid_range[0]')
  hi=$(c '.kubernetes.vmid_range[1]')
  n=$(pve_get "/nodes/$(node)/qemu" 2>/dev/null | jq --argjson lo "$lo" --argjson hi "$hi" '[.data[] | select(.vmid>=$lo and .vmid<=$hi and ((.template // 0)==0) and .status=="running")] | length' 2>/dev/null || echo "?")
  info "${n} VM(s) en cours d'exécution dans la plage ${lo}-${hi} (qm list)"
}

c_10_gitops() {
  section "ArgoCD et GitOps"
  [[ -s "$PROD_KUBECONFIG" ]] && kprod get --raw /readyz >/dev/null 2>&1 || { fail "API Kubernetes injoignable" "task check:9-cluster"; return; }
  kprod -n argocd get deploy argocd-server >/dev/null 2>&1 && pass "ArgoCD déployé (namespace argocd)" || fail "ArgoCD absent" "task phase:10-gitops"
  kprod -n argocd get secret sops-age >/dev/null 2>&1 && pass "Secret sops-age présent (clé du CLUSTER, jamais celle de l'opérateur)" || fail "Secret sops-age absent" "task bootstrap:gitops"
  kprod -n argocd get secret repo-pad >/dev/null 2>&1 && pass "Secret du dépôt (deploy key) présent" || fail "Secret repo-pad absent" "task bootstrap:gitops"
  local root
  root=$(kprod -n argocd get application root -o jsonpath='{.status.sync.status}/{.status.health.status}' 2>/dev/null || echo "")
  [[ "$root" == Synced/* ]] && pass "Application root : ${root}" || fail "Application root : ${root:-absente}" "kubectl -n argocd describe application root ; clé du dépôt valide ? commit poussé ?"
  local bad total
  total=$(kprod -n argocd get applications --no-headers 2>/dev/null | grep -c . || true)
  bad=$(kprod -n argocd get applications -o jsonpath='{range .items[*]}{.metadata.name}={.status.sync.status}/{.status.health.status}{"\n"}{end}' 2>/dev/null | grep -v '=Synced/Healthy$' | tr '\n' ' ')
  if [[ -z "$bad" && "$total" -gt 0 ]]; then
    pass "${total} Applications Synced/Healthy"
  elif ((total == 0)); then
    fail "aucune Application ArgoCD" "root pas encore synchronisée ? kubectl -n argocd get applications"
  else
    warn "Applications pas encore Synced/Healthy : ${bad}" "attendre quelques minutes (images à tirer) ; digests sha256:000… tant que les images ne sont pas publiées (actions manuelles §7) ; ksops / sops-age : docs/SECRETS.md"
  fi
  local sc
  sc=$(kprod get storageclass -o name 2>/dev/null | grep -c . || true)
  ((sc > 0)) && pass "StorageClass présente (Proxmox CSI)" || warn "aucune StorageClass pour l'instant" "l'Application proxmox-csi est-elle Synced ? secret du CSI renseigné ?"
}

# netbird_api <jeton> <chemin> : GET sur l'API NetBird (jeton via --config, jamais dans la ligne de commande).
netbird_api() {
  curl -fsS --max-time 15 --config <(printf 'header = "Authorization: Token %s"\n' "$1") "https://$(fqdn vpn)/api$2"
}

# check_routing_peers <jeton> : un routing peer connecté par groupe pad-routers-* et un routeur actif par network.
check_routing_peers() {
  local tok=$1 peers nets g z n nid routers
  section "Routing peers NetBird (agents enrôlés, routes actives)"
  if ! peers=$(netbird_api "$tok" /peers 2>/dev/null) || ! jq -e . >/dev/null 2>&1 <<<"$peers"; then
    fail "liste des peers NetBird illisible" "PAT de secrets/netbird-tofu.sops.yaml valide ?"
    return
  fi
  for z in challenges bastion; do
    g=$(c ".netbird.technical_groups.routers_${z}")
    n=$(jq --arg g "$g" '[.[] | select(.connected == true and ((.groups // []) | map(.name) | index($g)))] | length' <<<"$peers")
    ((n >= 1)) && pass "routing peer ${z} connecté (${n} pair(s) dans ${g})" || fail "aucun pair connecté dans le groupe ${g}" "task netbird:agents ; sur le LXC : netbird status ; setup key expirée : task netbird:rotate-keys"
  done
  nets=$(netbird_api "$tok" /networks 2>/dev/null || echo '[]')
  for n in "$(c '.netbird.network_name')" "$(c '.netbird.bastion_network_name')"; do
    nid=$(jq -r --arg n "$n" '.[] | select(.name == $n) | .id' <<<"$nets" | head -n1)
    if [[ -z "$nid" ]]; then
      fail "network NetBird ${n} introuvable" "task plan:40-netbird"
      continue
    fi
    routers=$(netbird_api "$tok" "/networks/${nid}/routers" 2>/dev/null || echo '[]')
    jq -e '[.[] | select(.enabled == true)] | length >= 1' >/dev/null 2>&1 <<<"$routers" && pass "network ${n} : routeur actif" || fail "network ${n} : aucun routeur actif" "task apply-netbird (network_router de 40-netbird)"
  done
}

c_11_acces() {
  section "Stacks 40-netbird et 50-warpgate"
  stack_has_state 40-netbird && pass "state 40-netbird présent" || fail "pas de state pour 40-netbird" "task phase:11-acces (PAT NetBird requis)"
  stack_has_state 50-warpgate && pass "state 50-warpgate présent" || fail "pas de state pour 50-warpgate" "task phase:11-acces (jeton Warpgate requis)"
  pending_report 11-acces
  local tok pol
  if tok=$(sops --decrypt --extract '["api_token"]' "${ROOT_DIR}/secrets/netbird-tofu.sops.yaml" 2>/dev/null) && [[ -n "$tok" && "$tok" != *CHANGEME* ]]; then
    if pol=$(curl -fsS --max-time 15 --config <(printf 'header = "Authorization: Token %s"\n' "$tok") "https://$(fqdn vpn)/api/policies" 2>/dev/null) && jq -e . >/dev/null 2>&1 <<<"$pol"; then
      pass "API NetBird authentifiée"
      if jq -e '.[] | select(.name=="Default" and .enabled==true)' <<<"$pol" >/dev/null 2>&1; then
        fail "la policy NetBird « Default » (tous vers tous) est encore ACTIVE" "dashboard NetBird > Access Control > Policies : la désactiver puis la supprimer (action manuelle 4)"
      else
        pass "la policy « Default » n'est plus active"
      fi
      jq -e '[.[] | select(.name=="staff-vers-bastion")] | length > 0' <<<"$pol" >/dev/null 2>&1 && pass "policy staff-vers-bastion présente" || fail "policy staff-vers-bastion absente" "task plan:40-netbird"
      check_routing_peers "$tok"
    else
      fail "API NetBird injoignable ou PAT refusé" "PAT de secrets/netbird-tofu.sops.yaml valide ? https://$(fqdn vpn)"
    fi
  else
    warn "PAT NetBird non renseigné : policies non vérifiables" "action manuelle 5"
  fi
  if [[ -s "$PROD_KUBECONFIG" ]] && kprod get --raw /readyz >/dev/null 2>&1; then
    local r
    r=$(kprod -n "$(c '.namespaces.netbird_sync')" get deploy netbird-sync -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "")
    [[ "${r:-0}" -ge 1 ]] && pass "netbird-sync prêt" || warn "netbird-sync pas prêt" "PAT dans gitops/apps/netbird-sync/secret.sops.yaml puis commit + push ; kubectl -n netbird-sync logs deploy/netbird-sync"
  fi
  local rip rname
  for rname in nbrouter warpgate; do
    rip=$(svc_ip "$rname")
    if lxc_ssh "$rip" netbird status >/dev/null 2>&1; then
      pass "agent NetBird actif sur ${rname} (${rip})"
    else
      warn "agent NetBird injoignable ou non connecté sur ${rname} (${rip})" "task netbird:agents ; sur le LXC : netbird status, journalctl -u netbird ; /dev/net/tun présent ? (rôle lxc-tun)"
    fi
  done
}

c_12_verify() {
  section "Smoke tests (scripts/verify.sh)"
  if bash "${ROOT_DIR}/scripts/verify.sh"; then
    pass "scripts/verify.sh : tout OK"
  else
    fail "scripts/verify.sh signale des KO (ci-dessus)" "lancer depuis un poste connecté à NetBird pour les contrôles internes ; guide §checklist finale"
  fi
  section "Actions manuelles à ne pas oublier (docs/operations/actions-post-deploiement.md)"
  warn "MFA du premier infra-admins enrôlé ?" "action 3"
  warn "policy NetBird « Default » supprimée ?" "action 4 (vérifiée en phase 11 si le PAT est présent)"
  warn "images publiées, digests sha256:000… remplacés ?" "action 7"
  warn "identifiants de pull Zot posés sur les nœuds challenges ?" "action 8"
  warn "clé cosign / mode enforce ?" "action 9"
  warn "protection de la branche main ?" "action 10"
}

# --- contrôles après destruction ---------------------------------------------------------------------------------------
c_cluster_detruit() {
  section "Le cluster $(c '.kubernetes.cluster_name') est-il bien détruit ?"
  [[ -e "$PROD_KUBECONFIG" ]] && fail "kubeconfig encore présent" "rm .state/kubeconfig .state/talosconfig (le script de destruction les supprime normalement)" || pass "plus de kubeconfig"
  if have kind && kind get clusters 2>/dev/null | grep -qx pad-bootstrap; then fail "cluster kind pad-bootstrap encore présent" "kind delete cluster --name pad-bootstrap"; else pass "pas de cluster kind"; fi
  local lo hi list tag
  lo=$(c '.kubernetes.vmid_range[0]')
  hi=$(c '.kubernetes.vmid_range[1]')
  tag=$(c '.kubernetes.cluster_name')
  if list=$(pve_get "/cluster/resources?type=vm" 2>/dev/null); then
    local left
    left=$(jq -r --argjson lo "$lo" --argjson hi "$hi" --arg tag "$tag" '.data[] | select(.vmid>=$lo and .vmid<=$hi and ((.template // 0)==0) and ((.tags // "") | split(";") | index($tag))) | "\(.vmid):\(.name)"' <<<"$list" | tr '\n' ' ')
    [[ -z "$left" ]] && pass "aucune VM étiquetée ${tag} dans ${lo}-${hi}" || fail "VM restantes : ${left}" "task cluster:destroy-force (suppression directe par tag, avec confirmation)"
  else
    fail "API Proxmox injoignable" "task check:0-prereqs"
  fi
  local orphans
  orphans=$(host_ssh "sudo -n pvesm list $(c '.host.datastore_vm') 2>/dev/null | awk '/pvc-/ {print \$1}'" 2>/dev/null | tr '\n' ' ')
  if [[ -n "$orphans" ]]; then
    warn "volumes persistants orphelins du CSI sur $(c '.host.datastore_vm') : ${orphans}" "à supprimer s'ils ne servent plus : sur l'hôte, pvesm free <volid> pour chacun (les données de CTFd/Garage y étaient : sauvegarde faite ?)"
  else
    pass "aucun volume persistant (pvc-*) orphelin sur $(c '.host.datastore_vm')"
  fi
}

c_tout_detruit() {
  c_cluster_detruit
  section "Ce qui devrait avoir disparu avec task destroy"
  local s id st
  for s in $(yq -r '.services | keys | .[]' "$CONTRACTS"); do
    id=$(svc_vmid "$s")
    st=$(vm_status "$id" lxc)
    [[ -z "$st" ]] && pass "LXC ${id} ${s} supprimé" || fail "LXC ${id} ${s} existe encore (${st})" "pct stop ${id} --skiplock ; pct destroy ${id} --purge"
  done
  st=$(vm_status "$(c '.router.vmid')" qemu)
  [[ -z "$st" ]] && pass "VM routeur supprimée" || fail "VM routeur existe encore (${st})" "qm stop $(c '.router.vmid') ; qm destroy $(c '.router.vmid') --purge"
  st=$(vm_status "$(c '.kubernetes.talos_template.vmid')" qemu)
  [[ -z "$st" ]] && pass "template Talos supprimé" || fail "template Talos existe encore" "qm destroy $(c '.kubernetes.talos_template.vmid') --purge"
  local s2 left=()
  for s2 in "${TOFU_STATE_DIR}"/*.tfstate; do
    [[ -s "$s2" ]] && left+=("$(basename "$s2" .tfstate)")
  done
  ((${#left[@]} == 0)) && pass "plus aucun state tofu non vide dans .state/tofu" || warn "states tofu restants : ${left[*]}" "normal si une destruction a échoué ; pour repartir de zéro après coup : voir guide §« Repartir vraiment de zéro »"
}

# --- préconditions humaines (appelées AVANT d'agir par les tâches phase:*) -----------------------------------------------
# pre_gitops : ArgoCD lit le dépôt distant ; ce qui n'est pas commité et poussé n'existe pas pour lui.
pre_gitops() {
  section "Avant ArgoCD : tout est-il commité ET poussé ?"
  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain -- gitops secrets infra/contracts.yaml 2>/dev/null)" ]]; then
    fail "des fichiers de gitops/, secrets/ ou du contrat sont modifiés ou non suivis" "git status ; git add gitops secrets infra/contracts.yaml && git commit && git push (secrets OIDC de la phase 7 compris)"
  else
    pass "gitops/, secrets/ et contrat commités"
  fi
  local up
  up=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo "")
  if [[ -z "$up" ]]; then
    warn "aucune branche amont : impossible de savoir si le commit est poussé" "git push -u origin <branche> ; ArgoCD suit la branche git.branch du contrat ($(c '.git.branch'))"
  elif [[ -n "$(git -C "$ROOT_DIR" log '@{u}..HEAD' --oneline -- gitops 2>/dev/null)" ]]; then
    fail "des commits touchant gitops/ ne sont pas poussés vers ${up}" "git push"
  else
    pass "gitops/ poussé vers ${up}"
  fi
  pending_report 10-gitops
}

# pre_acces : les jetons créés à la main dans les dashboards doivent exister avant les stacks 40 et 50.
pre_acces() {
  section "Avant NetBird/Warpgate (stacks 40 et 50) : jetons créés à la main ?"
  local f k
  for f in secrets/netbird-tofu.sops.yaml secrets/warpgate-tofu.sops.yaml; do
    k=$(sops --decrypt --extract '["api_token"]' "${ROOT_DIR}/${f}" 2>/dev/null || echo CHANGEME)
    if [[ -z "$k" || "$k" == *CHANGEME* ]]; then
      case "$f" in
        *netbird*) fail "${f} : api_token à renseigner" "dashboard NetBird (https://$(fqdn vpn)) > Team > Service Users ou Settings > Personal Access Tokens ; sops ${f} ; reporter aussi le PAT dans secrets/netbird.sops.yaml (netbird_server_api_token)" ;;
        *) fail "${f} : api_token à renseigner" "UI admin Warpgate > Config > API tokens ; sops ${f}" ;;
      esac
    else
      pass "${f} : api_token renseigné"
    fi
  done
}

# --- attente d'OPNsense --------------------------------------------------------------------------------------------------
wait_opnsense() {
  local gw timeout=${PAD_WAIT_OPNSENSE:-900} start code
  gw=$(c '.zones.mgmt.gw')
  start=$(date +%s)
  printf 'Attente de la GUI OPNsense (%s) depuis l'"'"'hôte, %ss max (import de configuration au premier démarrage)...\n' "$gw" "$timeout"
  while :; do
    code=$(host_ssh curl -ksS --max-time 5 -o /dev/null -w '%{http_code}' "https://${gw}/" 2>/dev/null || echo 000)
    if [[ "$code" =~ ^(200|301|302|303|401)$ ]]; then
      echo "OPNsense répond (HTTP ${code})."
      return 0
    fi
    if (($(date +%s) - start > timeout)); then
      echo "KO  OPNsense ne répond pas après ${timeout}s." >&2
      echo "    -> à regarder : console 'qm terminal $(c '.router.vmid')' ; import manuel de la configuration : infra/opnsense/README.md" >&2
      return 1
    fi
    sleep 10
  done
}

# ======================================================================================================================
usage() {
  echo "usage : $0 <phase>|list|wait-opnsense" >&2
  printf '  %s\n' "${PHASES[@]}" cluster-detruit tout-detruit >&2
  exit 2
}

name=${1:-}
case "$name" in
  list) printf '%s\n' "${PHASES[@]}"; exit 0 ;;
  wait-opnsense) wait_opnsense; exit $? ;;
  pre-gitops) need_for_check yq sops python3 && pre_gitops ;;
  pre-acces) need_for_check yq sops && pre_acces ;;
  0-prereqs) need_for_check yq jq curl sops && c_0_prereqs ;;
  1-reseau) need_for_check yq jq curl sops ssh && c_1_reseau ;;
  2-routeur) need_for_check yq jq curl sops ssh && c_2_routeur ;;
  3-image-talos) need_for_check yq jq curl sops && c_3_image_talos ;;
  4-lxc) need_for_check yq jq curl sops ssh && c_4_lxc ;;
  5-dns) need_for_check yq sops && c_5_dns ;;
  6-services-1) need_for_check yq jq curl sops ssh && c_6_services_1 ;;
  7-identite) need_for_check yq curl sops python3 && c_7_identite ;;
  8-services-2) need_for_check yq jq curl sops ssh && c_8_services_2 ;;
  9-cluster) need_for_check yq jq kubectl sops && c_9_cluster ;;
  10-gitops) need_for_check yq kubectl && c_10_gitops ;;
  11-acces) need_for_check yq jq curl sops python3 && c_11_acces ;;
  12-verify) need_for_check yq curl && c_12_verify ;;
  cluster-detruit) need_for_check yq jq curl sops ssh && c_cluster_detruit ;;
  tout-detruit) need_for_check yq jq curl sops ssh && c_tout_detruit ;;
  *) usage ;;
esac
summary "${name}"
