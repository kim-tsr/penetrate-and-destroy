package main

import (
	"strings"
	"testing"
)

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
	if len(p.FromCIDRs) != 2 || p.FromCIDRs[0] != "10.20.70.10/32" || p.FromCIDRs[1] != "100.64.0.0/10" {
		t.Fatalf("CIDR inattendus: %v", p.FromCIDRs)
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
		"image":            "registry.example/pad/web@sha256:abc",
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
	base := func() map[string]string { return map[string]string{"image": "img:1"} }
	mut := map[string]func(m map[string]string){
		"image manquante":    func(m map[string]string) { delete(m, "image") },
		"env_FLAG interdit":  func(m map[string]string) { m["env_FLAG"] = "x" },
		"nom d'env invalide": func(m map[string]string) { m["env_1BAD"] = "x" },
		"quantité invalide":  func(m map[string]string) { m["limits_cpu"] = "beaucoup" },
		"ressource inconnue": func(m map[string]string) { m["limits_gpu"] = "1" },
		"uid invalide":       func(m map[string]string) { m["run_as_user"] = "0" },
		"bool invalide":      func(m map[string]string) { m["read_only_rootfs"] = "peut-être" },
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
