package main

import (
	"sync"
	"testing"

	"github.com/pulumi/pulumi/sdk/v3/go/common/resource"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type recorded struct {
	typ    string
	inputs resource.PropertyMap
}

type mocks struct {
	mu  sync.Mutex
	res []recorded
}

func (m *mocks) NewResource(args pulumi.MockResourceArgs) (string, resource.PropertyMap, error) {
	m.mu.Lock()
	m.res = append(m.res, recorded{typ: args.TypeToken, inputs: args.Inputs})
	m.mu.Unlock()
	out := args.Inputs.Copy()
	if args.TypeToken == "kubernetes:core/v1:Service" {
		out["status"] = resource.NewObjectProperty(resource.PropertyMap{
			"loadBalancer": resource.NewObjectProperty(resource.PropertyMap{
				"ingress": resource.NewArrayProperty([]resource.PropertyValue{
					resource.NewObjectProperty(resource.PropertyMap{"ip": resource.NewStringProperty("10.20.70.101")}),
				}),
			}),
		})
	}
	return args.Name + "_id", out, nil
}

func (m *mocks) Call(pulumi.MockCallArgs) (resource.PropertyMap, error) {
	return resource.PropertyMap{}, nil
}

func (m *mocks) find(t *testing.T, typ string) resource.PropertyMap {
	t.Helper()
	for _, r := range m.res {
		if r.typ == typ {
			return r.inputs
		}
	}
	t.Fatalf("ressource %s non créée", typ)
	return nil
}

func runBuild(t *testing.T, add map[string]string) (*mocks, string) {
	t.Helper()
	cfg, err := ParseConfig("Abc123", add, testPolicy(t))
	if err != nil {
		t.Fatal(err)
	}
	m := &mocks{}
	var info string
	err = pulumi.RunErr(func(ctx *pulumi.Context) error {
		out, err := Build(ctx, cfg)
		if err != nil {
			return err
		}
		// Export force la résolution de l'Output avant la fin du run.
		ctx.Export("connection_info", out.ApplyT(func(s string) string { info = s; return s }).(pulumi.StringOutput))
		return nil
	}, pulumi.WithMocks("pad-k8s-instance", "test", m))
	if err != nil {
		t.Fatal(err)
	}
	return m, info
}

func TestBuildResources(t *testing.T) {
	m, info := runBuild(t, map[string]string{
		"image":            testImage,
		"ports":            "8080/tcp",
		"flag":             "PAD{test}",
		"pad_source_id":    "7",
		"pad_challenge_id": "12",
	})
	if info != "10.20.70.101:8080" {
		t.Errorf("connection_info = %q", info)
	}

	ns := m.find(t, "kubernetes:core/v1:Namespace")
	if ns["metadata"].ObjectValue()["name"].StringValue() != "inst-abc123" {
		t.Errorf("namespace: %v", ns)
	}
	if ns["metadata"].ObjectValue()["labels"].ObjectValue()["pad.io/team"].StringValue() != "7" {
		t.Errorf("label team absent: %v", ns)
	}

	svc := m.find(t, "kubernetes:core/v1:Service")
	spec := svc["spec"].ObjectValue()
	if spec["type"].StringValue() != "LoadBalancer" {
		t.Errorf("type service: %v", spec["type"])
	}
	if svc["metadata"].ObjectValue()["labels"].ObjectValue()["pad.io/lb-pool"].StringValue() != "instances" {
		t.Errorf("label de pool absent: %v", svc["metadata"])
	}

	dep := m.find(t, "kubernetes:apps/v1:Deployment")
	pod := dep["spec"].ObjectValue()["template"].ObjectValue()["spec"].ObjectValue()
	if pod["nodeSelector"].ObjectValue()["pad.io/pool"].StringValue() != "challenges" {
		t.Errorf("nodeSelector: %v", pod["nodeSelector"])
	}
	tol := pod["tolerations"].ArrayValue()[0].ObjectValue()
	if tol["key"].StringValue() != "pad.io/pool" || tol["effect"].StringValue() != "NoSchedule" {
		t.Errorf("toleration: %v", tol)
	}
	ctr := pod["containers"].ArrayValue()[0].ObjectValue()
	foundFlag := false
	for _, e := range ctr["env"].ArrayValue() {
		o := e.ObjectValue()
		if o["name"].StringValue() == "FLAG" && o["value"].StringValue() == "PAD{test}" {
			foundFlag = true
		}
	}
	if !foundFlag {
		t.Errorf("env FLAG absent: %v", ctr["env"])
	}
	if ctr["resources"].ObjectValue()["limits"].ObjectValue()["memory"].StringValue() != "256Mi" {
		t.Errorf("limits: %v", ctr["resources"])
	}

	np := m.find(t, "kubernetes:networking.k8s.io/v1:NetworkPolicy")
	nps := np["spec"].ObjectValue()
	types := nps["policyTypes"].ArrayValue()
	if len(types) != 2 {
		t.Errorf("policyTypes: %v", types)
	}
	from := nps["ingress"].ArrayValue()[0].ObjectValue()["from"].ArrayValue()
	if len(from) != 1 || from[0].ObjectValue()["ipBlock"].ObjectValue()["cidr"].StringValue() != "10.20.70.10/32" {
		t.Errorf("ingress from (routing peer seul): %v", from)
	}
	if name := np["metadata"].ObjectValue()["name"].StringValue(); name != NetworkPolicyName || name == "default-deny" {
		t.Errorf("nom de NetworkPolicy en conflit avec celle de Kyverno: %q", name)
	}
	// Aucune règle d'egress (pas de DNS : pas de tunnel DNS vers Internet).
	if eg, ok := nps["egress"]; ok && eg.IsArray() && len(eg.ArrayValue()) != 0 {
		t.Errorf("egress doit être vide: %v", eg)
	}
}

func TestBuildHardening(t *testing.T) {
	m, _ := runBuild(t, map[string]string{"image": testImage})
	dep := m.find(t, "kubernetes:apps/v1:Deployment")
	pod := dep["spec"].ObjectValue()["template"].ObjectValue()["spec"].ObjectValue()
	if hu, ok := pod["hostUsers"]; !ok || hu.BoolValue() {
		t.Errorf("hostUsers doit valoir false: %v", pod["hostUsers"])
	}
	if pod["automountServiceAccountToken"].BoolValue() {
		t.Error("automountServiceAccountToken doit valoir false")
	}
	if _, ok := pod["runtimeClassName"]; ok {
		t.Errorf("pas de runtimeClassName par défaut: %v", pod["runtimeClassName"])
	}
	for _, k := range []resource.PropertyKey{"hostNetwork", "hostPID", "hostIPC"} {
		if pod[k].BoolValue() {
			t.Errorf("%s doit valoir false", k)
		}
	}
	if pod["securityContext"].ObjectValue()["seccompProfile"].ObjectValue()["type"].StringValue() != "RuntimeDefault" {
		t.Errorf("seccomp pod: %v", pod["securityContext"])
	}
	ctr := pod["containers"].ArrayValue()[0].ObjectValue()
	sc := ctr["securityContext"].ObjectValue()
	if sc["allowPrivilegeEscalation"].BoolValue() || sc["privileged"].BoolValue() {
		t.Errorf("securityContext: %v", sc)
	}
	if caps := sc["capabilities"].ObjectValue()["drop"].ArrayValue(); len(caps) != 1 || caps[0].StringValue() != "ALL" {
		t.Errorf("capabilities: %v", caps)
	}
	res := ctr["resources"].ObjectValue()
	if res["limits"].ObjectValue()["ephemeral-storage"].StringValue() != "256Mi" || res["requests"].ObjectValue()["ephemeral-storage"].StringValue() != "64Mi" {
		t.Errorf("ephemeral-storage: %v", res)
	}
	ns := m.find(t, "kubernetes:core/v1:Namespace")
	if _, ok := ns["metadata"].ObjectValue()["labels"].ObjectValue()[DNSLabel]; ok {
		t.Error("pas de label DNS par défaut")
	}
}

func TestBuildDNSOptInAndRuntimeClass(t *testing.T) {
	cfg, err := ParseConfig("Abc123", map[string]string{"image": testImage, "dns": "cluster"}, Policy{
		LBPoolLabel: "pad.io/lb-pool", LBPool: "instances", FromCIDRs: []string{"10.20.70.10/32"},
		ImagePrefix: defaultImagePrefix, RuntimeClass: "gvisor", HostUsers: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := &mocks{}
	err = pulumi.RunErr(func(ctx *pulumi.Context) error {
		out, err := Build(ctx, cfg)
		if err != nil {
			return err
		}
		ctx.Export("connection_info", out)
		return nil
	}, pulumi.WithMocks("pad-k8s-instance", "test", m))
	if err != nil {
		t.Fatal(err)
	}
	ns := m.find(t, "kubernetes:core/v1:Namespace")
	if ns["metadata"].ObjectValue()["labels"].ObjectValue()[DNSLabel].StringValue() != DNSLabelValue {
		t.Errorf("label DNS absent: %v", ns["metadata"])
	}
	dep := m.find(t, "kubernetes:apps/v1:Deployment")
	pod := dep["spec"].ObjectValue()["template"].ObjectValue()["spec"].ObjectValue()
	if pod["runtimeClassName"].StringValue() != "gvisor" {
		t.Errorf("runtimeClassName: %v", pod["runtimeClassName"])
	}
	if !pod["hostUsers"].BoolValue() {
		t.Errorf("hostUsers=true attendu avec PAD_HOST_USERS: %v", pod["hostUsers"])
	}
}
