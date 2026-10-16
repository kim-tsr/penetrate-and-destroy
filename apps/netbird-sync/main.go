// netbird-sync : synchronise les Services LoadBalancer des namespaces d'instances
// avec des network resources + policies NetBird (accès limité au groupe de l'équipe).
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/controller"
	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/ctfd"
	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/netbird"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// waitNoOpenPolicy refuse de démarrer tant qu'une policy NetBird ouvre l'accès à tous les pairs (policy Default
// All<->All) : sans suppression de cette policy, l'isolation par équipe n'a aucun effet. Une API NetBird
// momentanément injoignable est réessayée (`attempts` fois) avant d'abandonner.
func waitNoOpenPolicy(ctx context.Context, nb controller.NetBird, log *slog.Logger, attempts int, delay time.Duration) error {
	var err error
	for i := 0; i < attempts; i++ {
		err = controller.GuardOpenPolicies(ctx, nb)
		if err == nil || errors.Is(err, controller.ErrOpenPolicy) {
			return err
		}
		log.Warn("API NetBird injoignable au démarrage", "err", err, "essai", i+1)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return err
}

func main() {
	var (
		metricsAddr = flag.String("metrics-bind-address", ":8080", "adresse des métriques Prometheus")
		probeAddr   = flag.String("health-probe-bind-address", ":8081", "adresse des probes healthz/readyz")
		resync      = flag.Duration("resync", 10*time.Minute, "période de réconciliation complète")
		membership  = flag.Duration("membership-interval", time.Minute, "période de synchronisation des membres des groupes d'équipe")
	)
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)
	ctrl.SetLogger(logr.FromSlogHandler(log.Handler()))

	// contracts: netbird.network_name, netbird.team_group_prefix, namespaces.instances_prefix
	cfg := controller.Config{
		NetworkName:     env("NETBIRD_NETWORK_NAME", "pad-instances"),
		TeamGroupPrefix: env("NETBIRD_TEAM_GROUP_PREFIX", "ctf-team-"),
		NamespacePrefix: env("INSTANCES_NAMESPACE_PREFIX", "inst-"),
		Resync:          *resync,
	}
	nb, err := netbird.New(os.Getenv("NETBIRD_API_URL"), os.Getenv("NETBIRD_API_TOKEN"), nil)
	if err != nil {
		log.Error("configuration NetBird invalide", "err", err)
		os.Exit(1)
	}

	// Membres d'équipe : endpoint interne de CTFd (plugin pad_teams), jeton de service obligatoire.
	// contracts: apps.ctfd.service
	cf, err := ctfd.New(env("CTFD_URL", "http://ctfd.ctfd.svc.cluster.local:8000"), os.Getenv("PAD_INTERNAL_TOKEN"), nil)
	if err != nil {
		log.Error("configuration CTFd invalide", "err", err)
		os.Exit(1)
	}

	// Garde-fou : pas de démarrage tant que la policy « Default » (All<->All) existe.
	startCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	err = waitNoOpenPolicy(startCtx, nb, log, 12, 10*time.Second)
	cancel()
	if err != nil {
		log.Error("refus de démarrer : supprimer la policy NetBird ouverte à tous (voir infra/tofu/stacks/40-netbird/README.md)", "err", err)
		os.Exit(1)
	}

	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		log.Error("scheme", "err", err)
		os.Exit(1)
	}
	_ = corev1.AddToScheme(scheme)

	// Un seul replica : pas d'élection de leader (évite le RBAC sur les Leases).
	mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
		Scheme:                 scheme,
		Metrics:                metricsserver.Options{BindAddress: *metricsAddr},
		HealthProbeBindAddress: *probeAddr,
	})
	if err != nil {
		log.Error("manager", "err", err)
		os.Exit(1)
	}
	r := &controller.ServiceReconciler{Client: mgr.GetClient(), NB: nb, Members: cf, Cfg: cfg, Log: log}
	if err := r.SetupWithManager(mgr); err != nil {
		log.Error("contrôleur", "err", err)
		os.Exit(1)
	}
	if err := mgr.Add(&controller.MembershipSyncer{
		Client: mgr.GetClient(), NB: nb, Members: cf, Cfg: cfg, Log: log, Interval: *membership,
	}); err != nil {
		log.Error("synchronisation des membres", "err", err)
		os.Exit(1)
	}
	_ = mgr.AddHealthzCheck("healthz", healthz.Ping)
	_ = mgr.AddReadyzCheck("readyz", healthz.Ping)

	log.Info("démarrage", "network", cfg.NetworkName, "resync", cfg.Resync.String())
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		log.Error("arrêt en erreur", "err", err)
		os.Exit(1)
	}
}
