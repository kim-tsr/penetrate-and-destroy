// Package controller réconcilie les Services LoadBalancer des namespaces d'instances
// avec les network resources et policies NetBird.
package controller

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/netbird"
)

const (
	Finalizer      = "pad.io/netbird-sync"
	TeamLabel      = "pad.io/team"
	ChallengeLabel = "pad.io/challenge"
)

var (
	reconcileTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "netbird_sync_reconcile_total", Help: "Réconciliations de Services d'instances.",
	}, []string{"result"})
	reconcileErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "netbird_sync_reconcile_errors_total", Help: "Réconciliations en erreur.",
	})
)

func init() { metrics.Registry.MustRegister(reconcileTotal, reconcileErrors) }

// NetBird est la partie de l'API NetBird utilisée par le contrôleur.
type NetBird interface {
	EnsureGroup(ctx context.Context, name string) (string, error)
	EnsureNetwork(ctx context.Context, name string) (string, error)
	UpsertResource(ctx context.Context, networkID string, r netbird.Resource) (string, error)
	DeleteResource(ctx context.Context, networkID, name string) error
	UpsertPolicy(ctx context.Context, p netbird.Policy) error
	DeletePolicy(ctx context.Context, name string) error
}

// Config paramètre le contrôleur (valeurs issues de infra/contracts.yaml).
type Config struct {
	NetworkName     string        // netbird.network_name
	TeamGroupPrefix string        // netbird.team_group_prefix
	NamespacePrefix string        // namespaces.instances_prefix
	Resync          time.Duration // réconciliation périodique
}

// ServiceReconciler implémente reconcile.Reconciler.
type ServiceReconciler struct {
	client.Client
	NB  NetBird
	Cfg Config
	Log *slog.Logger
}

// SetupWithManager enregistre le contrôleur (Services LoadBalancer des namespaces d'instances).
func (r *ServiceReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		Named("netbird-sync").
		For(&corev1.Service{}, builder.WithPredicates(predicate.NewPredicateFuncs(func(o client.Object) bool {
			return strings.HasPrefix(o.GetNamespace(), r.Cfg.NamespacePrefix)
		}))).
		Complete(r)
}

func (r *ServiceReconciler) tracked(svc *corev1.Service) bool {
	return strings.HasPrefix(svc.Namespace, r.Cfg.NamespacePrefix) && svc.Spec.Type == corev1.ServiceTypeLoadBalancer
}

func (r *ServiceReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	res, err := r.reconcile(ctx, req.NamespacedName)
	if err != nil {
		reconcileTotal.WithLabelValues("error").Inc()
		reconcileErrors.Inc()
		r.Log.Error("réconciliation en erreur", "service", req.String(), "err", err)
		return ctrl.Result{}, err
	}
	reconcileTotal.WithLabelValues("ok").Inc()
	return res, nil
}

func resourceName(svc *corev1.Service) string { return svc.Namespace + "-" + svc.Name }
func policyName(svc *corev1.Service) string   { return "pad-" + resourceName(svc) }

func (r *ServiceReconciler) reconcile(ctx context.Context, key types.NamespacedName) (ctrl.Result, error) {
	var svc corev1.Service
	if err := r.Get(ctx, key, &svc); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	if !strings.HasPrefix(svc.Namespace, r.Cfg.NamespacePrefix) {
		return ctrl.Result{}, nil
	}
	hasFinalizer := controllerutil.ContainsFinalizer(&svc, Finalizer)

	// Suppression (ou Service qui n'est plus un LoadBalancer) : nettoyage NetBird puis finalizer.
	if !svc.DeletionTimestamp.IsZero() || (hasFinalizer && svc.Spec.Type != corev1.ServiceTypeLoadBalancer) {
		if !hasFinalizer {
			return ctrl.Result{}, nil
		}
		if err := r.cleanup(ctx, &svc); err != nil {
			return ctrl.Result{}, err
		}
		before := svc.DeepCopy()
		controllerutil.RemoveFinalizer(&svc, Finalizer)
		if err := r.Patch(ctx, &svc, client.MergeFrom(before)); err != nil && !apierrors.IsNotFound(err) {
			return ctrl.Result{}, err
		}
		r.Log.Info("ressources NetBird supprimées", "service", key.String())
		return ctrl.Result{}, nil
	}
	if !r.tracked(&svc) {
		return ctrl.Result{}, nil
	}

	if !hasFinalizer {
		before := svc.DeepCopy()
		controllerutil.AddFinalizer(&svc, Finalizer)
		if err := r.Patch(ctx, &svc, client.MergeFrom(before)); err != nil {
			return ctrl.Result{}, err
		}
	}

	ip := loadBalancerIP(&svc)
	if ip == "" {
		r.Log.Info("IP LoadBalancer pas encore attribuée", "service", key.String())
		return ctrl.Result{}, nil // le changement de status redéclenchera la réconciliation
	}
	rules := portSets(&svc)
	if len(rules) == 0 {
		r.Log.Warn("aucun port TCP/UDP exploitable", "service", key.String())
		return ctrl.Result{}, nil
	}

	var ns corev1.Namespace
	if err := r.Get(ctx, types.NamespacedName{Name: svc.Namespace}, &ns); err != nil {
		return ctrl.Result{}, err
	}
	team := ns.Labels[TeamLabel]
	if team == "" {
		return ctrl.Result{}, fmt.Errorf("namespace %s sans label %s", ns.Name, TeamLabel)
	}

	teamGroup, err := r.NB.EnsureGroup(ctx, r.Cfg.TeamGroupPrefix+team)
	if err != nil {
		return ctrl.Result{}, err
	}
	resGroup, err := r.NB.EnsureGroup(ctx, r.Cfg.NetworkName)
	if err != nil {
		return ctrl.Result{}, err
	}
	netID, err := r.NB.EnsureNetwork(ctx, r.Cfg.NetworkName)
	if err != nil {
		return ctrl.Result{}, err
	}
	desc := fmt.Sprintf("netbird-sync: équipe %s, challenge %s", team, ns.Labels[ChallengeLabel])
	resID, err := r.NB.UpsertResource(ctx, netID, netbird.Resource{
		Name: resourceName(&svc), Description: desc, Address: ip + "/32", GroupIDs: []string{resGroup},
	})
	if err != nil {
		return ctrl.Result{}, err
	}
	if err := r.NB.UpsertPolicy(ctx, netbird.Policy{
		Name: policyName(&svc), Description: desc, SourceGroup: teamGroup, ResourceID: resID, Rules: rules,
	}); err != nil {
		return ctrl.Result{}, err
	}
	r.Log.Info("instance synchronisée", "service", key.String(), "ip", ip, "team", team)
	return ctrl.Result{RequeueAfter: r.Cfg.Resync}, nil
}

func (r *ServiceReconciler) cleanup(ctx context.Context, svc *corev1.Service) error {
	// La policy référence la resource : la supprimer en premier.
	if err := r.NB.DeletePolicy(ctx, policyName(svc)); err != nil {
		return err
	}
	netID, err := r.NB.EnsureNetwork(ctx, r.Cfg.NetworkName)
	if err != nil {
		return err
	}
	return r.NB.DeleteResource(ctx, netID, resourceName(svc))
}

func loadBalancerIP(svc *corev1.Service) string {
	for _, i := range svc.Status.LoadBalancer.Ingress {
		if i.IP != "" {
			return i.IP
		}
	}
	return ""
}

// portSets groupe les ports du Service par protocole (SCTP ignoré : non supporté par NetBird).
func portSets(svc *corev1.Service) []netbird.PortSet {
	byProto := map[string][]string{}
	for _, p := range svc.Spec.Ports {
		proto := strings.ToLower(string(p.Protocol))
		if proto == "" {
			proto = "tcp"
		}
		if proto != "tcp" && proto != "udp" {
			continue
		}
		byProto[proto] = append(byProto[proto], strconv.Itoa(int(p.Port)))
	}
	var out []netbird.PortSet
	for _, proto := range []string{"tcp", "udp"} {
		if ports := byProto[proto]; len(ports) > 0 {
			out = append(out, netbird.PortSet{Protocol: proto, Ports: ports})
		}
	}
	return out
}
