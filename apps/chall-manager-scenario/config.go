package main

import (
	"fmt"
	"maps"
	"net"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
)

// Valeurs du contrat infra/contracts.yaml, surchargeables par variables d'environnement
// du process chall-manager (héritées par le programme Pulumi).
const (
	// contracts: namespaces.instances_prefix
	namespacePrefix = "inst-"
	// contracts: kubernetes.lb_pool_label
	defaultLBPoolLabel = "pad.io/lb-pool"
	// contracts: kubernetes.lb_pools.instances
	defaultLBPool = "instances"
	// contracts: netbird.routing_peer_ip (/32). L'overlay NetBird (100.64.0.0/10) n'est PAS autorisé : le routeur est en
	// masquerade, la source vue par l'instance est le routing peer ; l'isolation par équipe est portée par les
	// policies NetBird (netbird-sync), pas par la NetworkPolicy.
	defaultFromCIDRs = "10.20.70.10/32"
	// contracts: netbird.overlay_cidr
	overlayCIDR = "100.64.0.0/10"
	// contracts: instances.image_prefix
	defaultImagePrefix = "registry.pad.internal/ctf/"

	maxPorts = 8
)

// Plafonds par conteneur. contracts: instances.limits_max
var maxLimits = map[string]string{"cpu": "2", "memory": "1Gi", "ephemeral-storage": "1Gi"}

// Valeurs par défaut (requests, limits) quand le challenge n'en fournit pas.
var (
	defaultRequests = map[string]string{"cpu": "50m", "memory": "64Mi", "ephemeral-storage": "64Mi"}
	defaultLimits   = map[string]string{"cpu": "500m", "memory": "256Mi", "ephemeral-storage": "256Mi"}
)

var (
	envNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	labelBad  = regexp.MustCompile(`[^A-Za-z0-9._-]`)
	dnsBad    = regexp.MustCompile(`[^a-z0-9-]`)
	digestRe  = regexp.MustCompile(`@sha256:[a-f0-9]{64}$`)
	imageRe   = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*(:\d+)?(/[a-z0-9]+([._-][a-z0-9]+)*)+(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@sha256:[a-f0-9]{64}$`)
)

// Port décrit un port exposé de l'instance.
type Port struct {
	Number   int
	Protocol string // TCP ou UDP
}

// Name est le nom de port Service (<= 15 caractères, DNS_LABEL).
func (p Port) Name() string {
	return fmt.Sprintf("p%d-%s", p.Number, strings.ToLower(p.Protocol))
}

// Policy regroupe les paramètres d'infrastructure (non contrôlés par le challenge).
type Policy struct {
	LBPoolLabel  string
	LBPool       string
	FromCIDRs    []string
	ImagePrefix  string // préfixe de registre obligatoire des images (se termine par /)
	HostUsers    bool   // true = pas de user namespace (échappatoire) ; défaut false = hostUsers: false
	RuntimeClass string // RuntimeClass optionnelle (ex. gvisor) ; vide = runtime par défaut
}

// Config est la configuration d'une instance, issue des clés `additional`.
type Config struct {
	Identity   string
	Namespace  string
	Image      string
	Ports      []Port
	Flag       string
	Env        map[string]string
	Requests   map[string]string
	Limits     map[string]string
	RunAsUser  int64
	ReadOnlyFS bool
	DNS        bool // true : DNS cluster uniquement (cluster.local), via CiliumNetworkPolicy générée par Kyverno
	Labels     map[string]string
	Policy     Policy
}

// PolicyFromEnv lit les paramètres d'infrastructure.
func PolicyFromEnv(getenv func(string) string) (Policy, error) {
	p := Policy{
		LBPoolLabel: defaultLBPoolLabel,
		LBPool:      defaultLBPool,
	}
	if v := getenv("PAD_LB_POOL_LABEL"); v != "" {
		p.LBPoolLabel = v
	}
	if v := getenv("PAD_LB_POOL"); v != "" {
		p.LBPool = v
	}
	raw := getenv("PAD_FROM_CIDRS")
	if raw == "" {
		raw = defaultFromCIDRs
	}
	for _, c := range strings.Split(raw, ",") {
		if c = strings.TrimSpace(c); c != "" {
			p.FromCIDRs = append(p.FromCIDRs, c)
		}
	}
	if len(p.FromCIDRs) == 0 {
		return p, fmt.Errorf("PAD_FROM_CIDRS: aucun CIDR")
	}
	for _, c := range p.FromCIDRs {
		if err := checkFromCIDR(c); err != nil {
			return p, fmt.Errorf("PAD_FROM_CIDRS: %w", err)
		}
	}

	p.ImagePrefix = defaultImagePrefix
	if v := getenv("PAD_IMAGE_PREFIX"); v != "" {
		p.ImagePrefix = v
	}
	if !strings.HasSuffix(p.ImagePrefix, "/") || strings.ContainsAny(p.ImagePrefix, " \t\n") || strings.Contains(p.ImagePrefix, "..") {
		return p, fmt.Errorf("PAD_IMAGE_PREFIX %q invalide (doit se terminer par /)", p.ImagePrefix)
	}
	if v := getenv("PAD_HOST_USERS"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return p, fmt.Errorf("PAD_HOST_USERS invalide %q", v)
		}
		p.HostUsers = b
	}
	p.RuntimeClass = strings.TrimSpace(getenv("PAD_RUNTIME_CLASS"))
	return p, nil
}

// checkFromCIDR refuse les sources trop larges : l'overlay NetBird (ou toute plage qui le recouvre) et tout préfixe
// plus large que /24. Seul le routing peer (et au plus son sous-réseau) peut joindre une instance.
func checkFromCIDR(c string) error {
	_, n, err := net.ParseCIDR(c)
	if err != nil {
		return fmt.Errorf("CIDR invalide %q", c)
	}
	ones, _ := n.Mask.Size()
	if ones < 24 {
		return fmt.Errorf("CIDR %q trop large (préfixe /24 minimum)", c)
	}
	_, overlay, _ := net.ParseCIDR(overlayCIDR)
	if overlay.Contains(n.IP) || n.Contains(overlay.IP) {
		return fmt.Errorf("CIDR %q recouvre l'overlay NetBird %s : l'accès par équipe est porté par les policies NetBird", c, overlayCIDR)
	}
	return nil
}

// ParseConfig valide l'identité et les clés `additional` et applique les défauts.
func ParseConfig(identity string, add map[string]string, pol Policy) (*Config, error) {
	ns, err := NamespaceName(identity)
	if err != nil {
		return nil, err
	}
	c := &Config{
		Identity:   identity,
		Namespace:  ns,
		Image:      strings.TrimSpace(add["image"]),
		Env:        map[string]string{},
		Requests:   maps.Clone(defaultRequests),
		Limits:     maps.Clone(defaultLimits),
		RunAsUser:  10001,
		ReadOnlyFS: false,
		Policy:     pol,
	}
	if c.Image == "" {
		return nil, fmt.Errorf("clé additional 'image' obligatoire")
	}
	if err := checkImage(c.Image, pol.ImagePrefix); err != nil {
		return nil, err
	}

	ports, err := ParsePorts(add["ports"])
	if err != nil {
		return nil, err
	}
	c.Ports = ports

	c.Flag = add["flag"]

	explicitReq := map[string]bool{}
	for k, v := range add {
		switch {
		case strings.HasPrefix(k, "env_"):
			name := strings.TrimPrefix(k, "env_")
			if !envNameRe.MatchString(name) {
				return nil, fmt.Errorf("nom de variable d'environnement invalide %q", name)
			}
			if name == "FLAG" {
				return nil, fmt.Errorf("env_FLAG interdit : utiliser la clé 'flag'")
			}
			c.Env[name] = v
		case strings.HasPrefix(k, "requests_"):
			name := strings.TrimPrefix(k, "requests_")
			c.Requests[name] = v
			explicitReq[name] = true
		case strings.HasPrefix(k, "limits_"):
			c.Limits[strings.TrimPrefix(k, "limits_")] = v
		}
	}
	if err := checkResources(c.Requests, c.Limits, explicitReq); err != nil {
		return nil, err
	}

	if v := add["run_as_user"]; v != "" {
		uid, err := strconv.ParseInt(v, 10, 64)
		if err != nil || uid < 1 {
			return nil, fmt.Errorf("run_as_user invalide %q (entier >= 1)", v)
		}
		c.RunAsUser = uid
	}
	if v := add["read_only_rootfs"]; v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("read_only_rootfs invalide %q", v)
		}
		c.ReadOnlyFS = b
	}

	if v := add["dns"]; v != "" {
		switch strings.ToLower(v) {
		case "cluster":
			c.DNS = true
		case "none":
		default:
			return nil, fmt.Errorf("dns invalide %q (none ou cluster)", v)
		}
	}

	c.Labels = map[string]string{
		"app.kubernetes.io/name":       "pad-instance",
		"app.kubernetes.io/managed-by": "chall-manager",
		"app.kubernetes.io/instance":   LabelValue(identity),
		"pad.io/zone":                  "challenges",
	}
	if v := add["pad_source_id"]; v != "" {
		kind := LabelValue(add["pad_source_kind"])
		if kind == "" {
			kind = "team"
		}
		c.Labels["pad.io/"+kind] = LabelValue(v)
	}
	if v := add["pad_challenge_id"]; v != "" {
		c.Labels["pad.io/challenge"] = LabelValue(v)
	}
	return c, nil
}

// checkImage impose le préfixe de registre de la plateforme et l'empreinte @sha256 (aucune référence mutable).
func checkImage(image, prefix string) error {
	if strings.ContainsAny(image, " \t\n") {
		return fmt.Errorf("image invalide %q", image)
	}
	if !strings.HasPrefix(image, prefix) {
		return fmt.Errorf("image %q hors du registre autorisé (préfixe %q obligatoire)", image, prefix)
	}
	if !digestRe.MatchString(image) {
		return fmt.Errorf("image %q sans empreinte : suffixe @sha256:<64 hex> obligatoire", image)
	}
	if !imageRe.MatchString(image) {
		return fmt.Errorf("référence d'image %q invalide", image)
	}
	return nil
}

// checkResources valide les quantités, borne chaque valeur (maxLimits) et vérifie requests <= limits.
// Une request par défaut supérieure à la limite fournie est ramenée à la limite.
func checkResources(requests, limits map[string]string, explicitReq map[string]bool) error {
	for _, m := range []map[string]string{requests, limits} {
		for name, q := range m {
			maxQ, ok := maxLimits[name]
			if !ok {
				return fmt.Errorf("ressource %q non supportée", name)
			}
			v, err := resource.ParseQuantity(q)
			if err != nil {
				return fmt.Errorf("quantité %s=%q invalide: %w", name, q, err)
			}
			if v.Sign() <= 0 {
				return fmt.Errorf("quantité %s=%q doit être > 0", name, q)
			}
			if mx := resource.MustParse(maxQ); v.Cmp(mx) > 0 {
				return fmt.Errorf("%s=%q dépasse le plafond %s", name, q, maxQ)
			}
		}
	}
	for name, lq := range limits {
		rq, ok := requests[name]
		if !ok {
			continue
		}
		r, l := resource.MustParse(rq), resource.MustParse(lq)
		if r.Cmp(l) > 0 {
			if explicitReq[name] {
				return fmt.Errorf("requests %s=%q supérieur à limits %s=%q", name, rq, name, lq)
			}
			requests[name] = lq
		}
	}
	return nil
}

// NamespaceName construit inst-<identity> (DNS-1123, 63 caractères maximum).
func NamespaceName(identity string) (string, error) {
	id := dnsBad.ReplaceAllString(strings.ToLower(identity), "-")
	id = strings.Trim(id, "-")
	if id == "" {
		return "", fmt.Errorf("identité vide ou inutilisable %q", identity)
	}
	ns := namespacePrefix + id
	if len(ns) > 63 {
		ns = strings.TrimRight(ns[:63], "-")
	}
	return ns, nil
}

// LabelValue normalise une valeur de label Kubernetes.
func LabelValue(v string) string {
	v = labelBad.ReplaceAllString(v, "-")
	if len(v) > 63 {
		v = v[:63]
	}
	return strings.Trim(v, "-_.")
}

// ParsePorts lit "8080/tcp,53/udp" (protocole TCP par défaut ; défaut 8080/tcp).
func ParsePorts(raw string) ([]Port, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []Port{{Number: 8080, Protocol: "TCP"}}, nil
	}
	seen := map[string]bool{}
	var out []Port
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		num, proto, _ := strings.Cut(item, "/")
		n, err := strconv.Atoi(strings.TrimSpace(num))
		if err != nil || n < 1 || n > 65535 {
			return nil, fmt.Errorf("port invalide %q", item)
		}
		proto = strings.ToUpper(strings.TrimSpace(proto))
		if proto == "" {
			proto = "TCP"
		}
		if proto != "TCP" && proto != "UDP" {
			return nil, fmt.Errorf("protocole invalide dans %q (TCP ou UDP)", item)
		}
		p := Port{Number: n, Protocol: proto}
		if seen[p.Name()] {
			return nil, fmt.Errorf("port dupliqué %q", item)
		}
		seen[p.Name()] = true
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("aucun port")
	}
	if len(out) > maxPorts {
		return nil, fmt.Errorf("trop de ports (%d max)", maxPorts)
	}
	return out, nil
}

// EnvKeys renvoie les noms d'env triés (sortie déterministe).
func (c *Config) EnvKeys() []string {
	keys := make([]string, 0, len(c.Env))
	for k := range c.Env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func osGetenv(k string) string { return os.Getenv(k) }
