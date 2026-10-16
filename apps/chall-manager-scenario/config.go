package main

import (
	"fmt"
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
	// contracts: netbird.routing_peer_ip (/32) et netbird.overlay_cidr
	defaultFromCIDRs = "10.20.70.10/32,100.64.0.0/10"

	maxPorts = 8
)

var (
	envNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	labelBad  = regexp.MustCompile(`[^A-Za-z0-9._-]`)
	dnsBad    = regexp.MustCompile(`[^a-z0-9-]`)
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
	LBPoolLabel string
	LBPool      string
	FromCIDRs   []string
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
	return p, nil
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
		Requests:   map[string]string{"cpu": "50m", "memory": "64Mi"},
		Limits:     map[string]string{"cpu": "500m", "memory": "256Mi"},
		RunAsUser:  10001,
		ReadOnlyFS: false,
		Policy:     pol,
	}
	if c.Image == "" {
		return nil, fmt.Errorf("clé additional 'image' obligatoire")
	}
	if strings.ContainsAny(c.Image, " \t\n") {
		return nil, fmt.Errorf("image invalide %q", c.Image)
	}

	ports, err := ParsePorts(add["ports"])
	if err != nil {
		return nil, err
	}
	c.Ports = ports

	c.Flag = add["flag"]

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
			c.Requests[strings.TrimPrefix(k, "requests_")] = v
		case strings.HasPrefix(k, "limits_"):
			c.Limits[strings.TrimPrefix(k, "limits_")] = v
		}
	}
	for _, m := range []map[string]string{c.Requests, c.Limits} {
		for name, q := range m {
			if name != "cpu" && name != "memory" && name != "ephemeral-storage" {
				return nil, fmt.Errorf("ressource %q non supportée", name)
			}
			if _, err := resource.ParseQuantity(q); err != nil {
				return nil, fmt.Errorf("quantité %s=%q invalide: %w", name, q, err)
			}
		}
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
