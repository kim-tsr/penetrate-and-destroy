package controller

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/netbird"
)

// fakeNB est un faux serveur de management NetBird en mémoire.
type fakeNB struct {
	mu        sync.Mutex
	seq       int
	groups    map[string]map[string]any // id -> objet
	networks  map[string]map[string]any
	resources map[string]map[string]any
	policies  map[string]map[string]any
	writes    int // POST/PUT/DELETE
	badAuth   int
}

func newFakeNB() *fakeNB {
	return &fakeNB{groups: map[string]map[string]any{}, networks: map[string]map[string]any{},
		resources: map[string]map[string]any{}, policies: map[string]map[string]any{}}
}

func (f *fakeNB) id(p string) string { f.seq++; return p + strconv.Itoa(f.seq) }

func list(m map[string]map[string]any) []any {
	out := []any{}
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func (f *fakeNB) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("Authorization") != "Token pat-test" {
		f.badAuth++
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body map[string]any
	raw, _ := io.ReadAll(r.Body)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	if r.Method != http.MethodGet {
		f.writes++
	}
	path := strings.TrimPrefix(r.URL.Path, "/api")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	reply := func(v any) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(v) }

	switch {
	case path == "/groups" && r.Method == http.MethodGet:
		reply(list(f.groups))
	case path == "/groups" && r.Method == http.MethodPost:
		body["id"] = f.id("g")
		f.groups[body["id"].(string)] = body
		reply(body)
	case path == "/networks" && r.Method == http.MethodGet:
		reply(list(f.networks))
	case path == "/networks" && r.Method == http.MethodPost:
		body["id"] = f.id("n")
		f.networks[body["id"].(string)] = body
		reply(body)
	case len(parts) >= 3 && parts[0] == "networks" && parts[2] == "resources":
		f.resourceOp(w, r, parts, body, reply)
	case parts[0] == "policies":
		f.policyOp(w, r, parts, body, reply)
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeNB) resourceOp(w http.ResponseWriter, r *http.Request, parts []string, body map[string]any, reply func(any)) {
	switch {
	case len(parts) == 3 && r.Method == http.MethodGet:
		reply(list(f.resources))
	case len(parts) == 3 && r.Method == http.MethodPost, len(parts) == 4 && r.Method == http.MethodPut:
		id := ""
		if len(parts) == 4 {
			id = parts[3]
		} else {
			id = f.id("r")
		}
		gs := []any{}
		for _, g := range body["groups"].([]any) {
			gs = append(gs, map[string]any{"id": g})
		}
		body["id"], body["groups"], body["type"] = id, gs, "host"
		f.resources[id] = body
		reply(body)
	case len(parts) == 4 && r.Method == http.MethodDelete:
		delete(f.resources, parts[3])
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeNB) policyOp(w http.ResponseWriter, r *http.Request, parts []string, body map[string]any, reply func(any)) {
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		reply(list(f.policies))
	case len(parts) == 1 && r.Method == http.MethodPost, len(parts) == 2 && r.Method == http.MethodPut:
		id := ""
		if len(parts) == 2 {
			id = parts[1]
		} else {
			id = f.id("p")
		}
		// Comme l'API : sources renvoyées en objets de groupe.
		for _, ru := range body["rules"].([]any) {
			rule := ru.(map[string]any)
			srcs := []any{}
			for _, s := range rule["sources"].([]any) {
				srcs = append(srcs, map[string]any{"id": s})
			}
			rule["sources"] = srcs
		}
		body["id"] = id
		f.policies[id] = body
		reply(body)
	case len(parts) == 2 && r.Method == http.MethodDelete:
		delete(f.policies, parts[1])
	default:
		http.NotFound(w, r)
	}
}

func fixture(t *testing.T, svc *corev1.Service) (*ServiceReconciler, *fakeNB, client.Client) {
	t.Helper()
	fnb := newFakeNB()
	srv := httptest.NewServer(fnb)
	t.Cleanup(srv.Close)
	nb, err := netbird.New(srv.URL, "pat-test", srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "inst-c1-t7",
		Labels: map[string]string{TeamLabel: "7", ChallengeLabel: "c1"}}}
	c := fake.NewClientBuilder().WithObjects(ns, svc).Build()
	r := &ServiceReconciler{Client: c, NB: nb, Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Cfg: Config{NetworkName: "pad-instances", TeamGroupPrefix: "ctf-team-", NamespacePrefix: "inst-", Resync: time.Minute}}
	return r, fnb, c
}

func lbService() *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Namespace: "inst-c1-t7", Name: "web"},
		Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer, Ports: []corev1.ServicePort{
			{Name: "http", Port: 80, Protocol: corev1.ProtocolTCP, TargetPort: intstr.FromInt32(8080)},
			{Name: "ssh", Port: 22, Protocol: corev1.ProtocolTCP},
			{Name: "dns", Port: 53, Protocol: corev1.ProtocolUDP},
		}},
		Status: corev1.ServiceStatus{LoadBalancer: corev1.LoadBalancerStatus{
			Ingress: []corev1.LoadBalancerIngress{{IP: "10.20.70.101"}}}},
	}
}

var key = types.NamespacedName{Namespace: "inst-c1-t7", Name: "web"}

func TestCreateThenIdempotentThenDelete(t *testing.T) {
	ctx := context.Background()
	r, fnb, c := fixture(t, lbService())

	res, err := r.Reconcile(ctx, reqFor(key))
	if err != nil {
		t.Fatal(err)
	}
	if res.RequeueAfter != time.Minute {
		t.Fatalf("resync attendu, obtenu %v", res.RequeueAfter)
	}
	if fnb.badAuth != 0 {
		t.Fatal("requête sans PAT valide")
	}

	// Groupes : équipe + groupe des resources ; un network ; une resource /32 ; une policy.
	names := map[string]string{}
	for id, g := range fnb.groups {
		names[g["name"].(string)] = id
	}
	if len(names) != 2 || names["ctf-team-7"] == "" || names["pad-instances"] == "" {
		t.Fatalf("groupes inattendus: %v", names)
	}
	if len(fnb.networks) != 1 || len(fnb.resources) != 1 || len(fnb.policies) != 1 {
		t.Fatalf("objets: n=%d r=%d p=%d", len(fnb.networks), len(fnb.resources), len(fnb.policies))
	}
	var res1 map[string]any
	for _, v := range fnb.resources {
		res1 = v
	}
	if res1["address"] != "10.20.70.101/32" || res1["name"] != "inst-c1-t7-web" {
		t.Fatalf("resource: %v", res1)
	}
	var pol map[string]any
	for _, v := range fnb.policies {
		pol = v
	}
	rules := pol["rules"].([]any)
	if len(rules) != 2 {
		t.Fatalf("2 règles (tcp, udp) attendues: %v", rules)
	}
	for _, ru := range rules {
		rule := ru.(map[string]any)
		src := rule["sources"].([]any)[0].(map[string]any)["id"]
		dst := rule["destinationResource"].(map[string]any)
		if src != names["ctf-team-7"] || dst["id"] != res1["id"] || rule["action"] != "accept" || rule["bidirectional"] != false {
			t.Fatalf("règle incorrecte: %v", rule)
		}
		ports := rule["ports"].([]any)
		switch rule["protocol"] {
		case "tcp":
			if len(ports) != 2 {
				t.Fatalf("ports tcp: %v", ports)
			}
		case "udp":
			if len(ports) != 1 || ports[0] != "53" {
				t.Fatalf("ports udp: %v", ports)
			}
		default:
			t.Fatalf("protocole: %v", rule["protocol"])
		}
	}

	// Finalizer posé.
	var got corev1.Service
	if err := c.Get(ctx, key, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Finalizers) != 1 || got.Finalizers[0] != Finalizer {
		t.Fatalf("finalizer: %v", got.Finalizers)
	}

	// Idempotence : 2e passe = aucune écriture NetBird.
	before := fnb.writes
	if _, err := r.Reconcile(ctx, reqFor(key)); err != nil {
		t.Fatal(err)
	}
	if fnb.writes != before {
		t.Fatalf("réconciliation non idempotente: %d écritures de plus", fnb.writes-before)
	}

	// Dérive : la policy est modifiée à la main -> corrigée.
	for _, v := range fnb.policies {
		v["enabled"] = false
	}
	if _, err := r.Reconcile(ctx, reqFor(key)); err != nil {
		t.Fatal(err)
	}
	for _, v := range fnb.policies {
		if v["enabled"] != true {
			t.Fatal("policy non restaurée")
		}
	}
	if len(fnb.policies) != 1 {
		t.Fatalf("policy dupliquée: %d", len(fnb.policies))
	}

	// Suppression du Service : le finalizer retient l'objet, le contrôleur nettoie.
	if err := c.Delete(ctx, &got); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(ctx, reqFor(key)); err != nil {
		t.Fatal(err)
	}
	if len(fnb.policies) != 0 || len(fnb.resources) != 0 {
		t.Fatalf("NetBird non nettoyé: p=%d r=%d", len(fnb.policies), len(fnb.resources))
	}
	if err := c.Get(ctx, key, &got); err == nil {
		t.Fatal("le Service aurait dû disparaître après retrait du finalizer")
	}
	// Reconcile sur objet absent : sans erreur.
	if _, err := r.Reconcile(ctx, reqFor(key)); err != nil {
		t.Fatal(err)
	}
}

func TestNoIPYetOnlyAddsFinalizer(t *testing.T) {
	svc := lbService()
	svc.Status = corev1.ServiceStatus{}
	r, fnb, _ := fixture(t, svc)
	if _, err := r.Reconcile(context.Background(), reqFor(key)); err != nil {
		t.Fatal(err)
	}
	if fnb.writes != 0 {
		t.Fatalf("aucune écriture NetBird attendue sans IP, obtenu %d", fnb.writes)
	}
}

func TestMissingTeamLabelIsError(t *testing.T) {
	r, _, c := fixture(t, lbService())
	var ns corev1.Namespace
	_ = c.Get(context.Background(), types.NamespacedName{Name: "inst-c1-t7"}, &ns)
	ns.Labels = nil
	if err := c.Update(context.Background(), &ns); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(context.Background(), reqFor(key)); err == nil {
		t.Fatal("erreur attendue sans label d'équipe")
	}
}
