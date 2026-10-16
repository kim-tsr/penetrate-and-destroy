package main

import (
	"strings"
	"testing"
)

// testImage est une image valide (préfixe du contrat + empreinte).
const testImage = "registry.pad.internal/ctf/web:1.0@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func testPolicy(t *testing.T) Policy {
	t.Helper()
	p, err := PolicyFromEnv(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPolicyDefaultsFollowContract(t *testing.T) {
	p := testPolicy(t)
	if p.LBPool != "instances" || p.LBPoolLabel != "pad.io/lb-pool" {
		t.Fatalf("pool inattendu: %+v", p)
	}
	if len(p.FromCIDRs) != 1 || p.FromCIDRs[0] != "10.20.70.10/32" {
		t.Fatalf("CIDR inattendus (le routing peer seul, pas l'overlay): %v", p.FromCIDRs)
	}
	if p.ImagePrefix != "registry.pad.internal/ctf/" || p.HostUsers || p.RuntimeClass != "" {
		t.Fatalf("politique inattendue: %+v", p)
	}
}

func TestPolicyRejectsBroadCIDRs(t *testing.T) {
	for _, bad := range []string{"100.64.0.0/10", "10.20.70.10/32,100.64.0.0/10", "100.64.1.0/24", "10.0.0.0/8", "0.0.0.0/0", "x"} {
		_, err := PolicyFromEnv(func(k string) string {
			if k == "PAD_FROM_CIDRS" {
				return bad
			}
			return ""
		})
		if err == nil {
			t.Errorf("PAD_FROM_CIDRS=%q devrait être refusé", bad)
		}
	}
	if _, err := PolicyFromEnv(func(k string) string {
		if k == "PAD_FROM_CIDRS" {
			return "10.20.70.0/24"
		}
		return ""
	}); err != nil {
		t.Errorf("un /24 hors overlay est accepté: %v", err)
	}
}

func TestPolicyEnvOverrides(t *testing.T) {
	p, err := PolicyFromEnv(func(k string) string {
		return map[string]string{"PAD_IMAGE_PREFIX": "r.example/x/", "PAD_HOST_USERS": "true", "PAD_RUNTIME_CLASS": "gvisor"}[k]
	})
	if err != nil || p.ImagePrefix != "r.example/x/" || !p.HostUsers || p.RuntimeClass != "gvisor" {
		t.Fatalf("surcharges: %+v %v", p, err)
	}
	for _, bad := range []string{"r.example/x", "r.example/../x/", "a b/"} {
		if _, err := PolicyFromEnv(func(k string) string {
			if k == "PAD_IMAGE_PREFIX" {
				return bad
			}
			return ""
		}); err == nil {
			t.Errorf("PAD_IMAGE_PREFIX=%q devrait être refusé", bad)
		}
	}
}

func TestNamespaceName(t *testing.T) {
	cases := map[string]string{
		"ABC123":                "inst-abc123",
		"a_b.c":                 "inst-a-b-c",
		strings.Repeat("x", 80): "inst-" + strings.Repeat("x", 58),
	}
	for in, want := range cases {
		got, err := NamespaceName(in)
		if err != nil || got != want {
			t.Errorf("NamespaceName(%q) = %q, %v ; attendu %q", in, got, err, want)
		}
	}
	if _, err := NamespaceName("___"); err == nil {
		t.Error("une identité inutilisable doit échouer")
	}
}

func TestParsePorts(t *testing.T) {
	ps, err := ParsePorts("")
	if err != nil || len(ps) != 1 || ps[0].Number != 8080 || ps[0].Protocol != "TCP" {
		t.Fatalf("défaut: %v %v", ps, err)
	}
	ps, err = ParsePorts("80, 53/udp")
	if err != nil || len(ps) != 2 || ps[1].Protocol != "UDP" || ps[1].Name() != "p53-udp" {
		t.Fatalf("liste: %v %v", ps, err)
	}
	for _, bad := range []string{"0", "70000", "80/sctp", "x", "80,80/tcp", "1,2,3,4,5,6,7,8,9"} {
		if _, err := ParsePorts(bad); err == nil {
			t.Errorf("ParsePorts(%q) devrait échouer", bad)
		}
	}
}

func TestParseConfig(t *testing.T) {
	pol := testPolicy(t)
	c, err := ParseConfig("Id42", map[string]string{
		"image":            testImage,
		"flag":             "PAD{x}",
		"env_MODE":         "prod",
		"limits_memory":    "512Mi",
		"pad_source_kind":  "team",
		"pad_source_id":    "7",
		"pad_challenge_id": "12",
	}, pol)
	if err != nil {
		t.Fatal(err)
	}
	if c.Namespace != "inst-id42" || c.Env["MODE"] != "prod" || c.Limits["memory"] != "512Mi" || c.Limits["cpu"] != "500m" {
		t.Fatalf("config inattendue: %+v", c)
	}
	if c.Labels["pad.io/team"] != "7" || c.Labels["pad.io/challenge"] != "12" {
		t.Fatalf("labels: %v", c.Labels)
	}
}

func TestParseConfigErrors(t *testing.T) {
	pol := testPolicy(t)
	base := func() map[string]string { return map[string]string{"image": testImage} }
	mut := map[string]func(m map[string]string){
		"image manquante":    func(m map[string]string) { delete(m, "image") },
		"env_FLAG interdit":  func(m map[string]string) { m["env_FLAG"] = "x" },
		"nom d'env invalide": func(m map[string]string) { m["env_1BAD"] = "x" },
		"quantité invalide":  func(m map[string]string) { m["limits_cpu"] = "beaucoup" },
		"ressource inconnue": func(m map[string]string) { m["limits_gpu"] = "1" },
		"uid invalide":       func(m map[string]string) { m["run_as_user"] = "0" },
		"bool invalide":      func(m map[string]string) { m["read_only_rootfs"] = "peut-être" },
		"dns invalide":       func(m map[string]string) { m["dns"] = "internet" },
		"image sans digest":  func(m map[string]string) { m["image"] = "registry.pad.internal/ctf/web:1.0" },
		"image hors registre": func(m map[string]string) {
			m["image"] = "docker.io/library/nginx@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		},
		"préfixe par détournement": func(m map[string]string) {
			m["image"] = "registry.pad.internal/ctf/../evil@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		},
		"digest trop court":              func(m map[string]string) { m["image"] = "registry.pad.internal/ctf/web@sha256:abc" },
		"cpu au-dessus du plafond":       func(m map[string]string) { m["limits_cpu"] = "4" },
		"mémoire au-dessus du plafond":   func(m map[string]string) { m["limits_memory"] = "2Gi" },
		"ephemeral au-dessus du plafond": func(m map[string]string) { m["limits_ephemeral-storage"] = "5Gi" },
		"requests > limits":              func(m map[string]string) { m["requests_memory"] = "512Mi" },
		"quantité nulle":                 func(m map[string]string) { m["limits_memory"] = "0" },
	}
	for name, f := range mut {
		m := base()
		f(m)
		if _, err := ParseConfig("id", m, pol); err == nil {
			t.Errorf("%s: erreur attendue", name)
		}
	}
	if _, err := ParseConfig("", base(), pol); err == nil {
		t.Error("identité vide: erreur attendue")
	}
}

func TestParseConfigResourceDefaults(t *testing.T) {
	c, err := ParseConfig("id", map[string]string{"image": testImage}, testPolicy(t))
	if err != nil {
		t.Fatal(err)
	}
	if c.Limits["ephemeral-storage"] != "256Mi" || c.Requests["ephemeral-storage"] != "64Mi" {
		t.Fatalf("ephemeral-storage par défaut absent: req=%v lim=%v", c.Requests, c.Limits)
	}
	// Une limite inférieure à la request par défaut ramène la request à la limite (au lieu d'échouer).
	c, err = ParseConfig("id", map[string]string{"image": testImage, "limits_memory": "32Mi", "limits_ephemeral-storage": "16Mi"}, testPolicy(t))
	if err != nil {
		t.Fatal(err)
	}
	if c.Requests["memory"] != "32Mi" || c.Requests["ephemeral-storage"] != "16Mi" {
		t.Fatalf("requests non ramenées: %v", c.Requests)
	}
	// Plafonds exacts acceptés.
	if _, err := ParseConfig("id", map[string]string{"image": testImage, "limits_cpu": "2", "limits_memory": "1Gi", "limits_ephemeral-storage": "1Gi"}, testPolicy(t)); err != nil {
		t.Fatalf("plafonds exacts: %v", err)
	}
}

func TestParseConfigDNS(t *testing.T) {
	pol := testPolicy(t)
	c, err := ParseConfig("id", map[string]string{"image": testImage}, pol)
	if err != nil || c.DNS {
		t.Fatalf("DNS désactivé par défaut: %+v %v", c, err)
	}
	c, err = ParseConfig("id", map[string]string{"image": testImage, "dns": "cluster"}, pol)
	if err != nil || !c.DNS {
		t.Fatalf("dns=cluster: %+v %v", c, err)
	}
}
