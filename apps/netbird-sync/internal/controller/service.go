// Package controller réconcilie les Services LoadBalancer des namespaces d'instances
// avec les network resources et policies NetBird.
package controller

import (
	"context"
	"errors"
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
	openPolicies = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "netbird_sync_open_policies", Help: "Policies NetBird actives dont la source est le groupe All (doit rester à 0).",
	})
	memberChanges = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "netbird_sync_team_member_changes_total", Help: "Pairs ajoutés ou retirés des groupes d'équipe.",
	}, []string{"op"})
)

func init() {
	metrics.Registry.MustRegister(reconcileTotal, reconcileErrors, openPolicies, memberChanges)
}

// NetBird est la partie de l'API NetBird utilisée par le contrôleur.
type NetBird interface {
	EnsureGroup(ctx context.Context, name string) (string, error)
	EnsureNetwork(ctx context.Context, name string) (string, error)
	UpsertResource(ctx context.Context, networkID string, r netbird.Resource) (string, error)
	DeleteResource(ctx context.Context, networkID, name string) error
	UpsertPolicy(ctx context.Context, p netbird.Policy) error
	DeletePolicy(ctx context.Context, name string) error
	// OpenPolicies liste les policies actives dont la source est « All » (policy Default All<->All).
	OpenPolicies(ctx context.Context) ([]string, error)
	// SyncGroupMembers ajuste les pairs du groupe aux utilisateurs NetBird des e-mails donnés.
	SyncGroupMembers(ctx context.Context, groupID string, emails []string) (added, removed int, err error)
}

// Members donne les e-mails des membres d'une équipe CTFd (source de vérité du rattachement joueur -> équipe).
type Members interface {
	TeamEmails(ctx context.Context, teamID string) ([]string, error)
}

// ErrOpenPolicy signale une policy NetBird qui ouvre l'accès à tous les pairs : aucune écriture n'est faite.
var ErrOpenPolicy = errors.New("policy NetBird ouverte à tous (source « All », ex. policy Default) : à supprimer, aucune synchronisation tant qu'elle existe")

// GuardOpenPolicies refuse de continuer si une policy active a le groupe « All » en source. Sans cela, supprimer ou
// désactiver la policy Default serait une étape manuelle oubliable, et toute l'isolation par équipe serait vaine.
func GuardOpenPolicies(ctx context.Context, nb NetBird) error {
	open, err := nb.OpenPolicies(ctx)
	if err != nil {
		return err
	}
	openPolicies.Set(float64(len(open)))
	if len(open) > 0 {
		return fmt.Errorf("%w : %s", ErrOpenPolicy, strings.Join(open, ", "))
	}
	return nil
}

// SyncTeamGroup aligne les pairs du groupe `ctf-team-<team>` sur les membres CTFd de l'équipe.
func SyncTeamGroup(ctx context.Context, nb NetBird, m Members, log *slog.Logger, groupID, team string) error {
	emails, err := m.TeamEmails(ctx, team)
	if err != nil {
		return err
	}
	added, removed, err := nb.SyncGroupMembers(ctx, groupID, emails)
	if err != nil {
		return err
	}
	if added > 0 {
		memberChanges.WithLabelValues("added").Add(float64(added))
	}
	if removed > 0 {
		memberChanges.WithLabelValues("removed").Add(float64(removed))
	}
	if added+removed > 0 {
		log.Info("membres du groupe d'équipe synchronisés", "team", team, "added", added, "removed", removed)
	}
	return nil
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
	NB      NetBird
	Members Members
	Cfg     Config
	Log     *slog.Logger
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

	if r.Members == nil {
		return ctrl.Result{}, errors.New("source des membres d'équipe (CTFd) non configurée")
	}
	if err := GuardOpenPolicies(ctx, r.NB); err != nil {
		return ctrl.Result{}, err
	}
	teamGroup, err := r.NB.EnsureGroup(ctx, r.Cfg.TeamGroupPrefix+team)
	if err != nil {
		return ctrl.Result{}, err
	}
	if err := SyncTeamGroup(ctx, r.NB, r.Members, r.Log, teamGroup, team); err != nil {
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
