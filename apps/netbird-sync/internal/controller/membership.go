package controller

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// MembershipSyncer rattache périodiquement les joueurs à leur groupe `ctf-team-<id>` pour toutes les équipes qui ont
// un namespace d'instance. La réconciliation d'un Service ne suffit pas : un joueur qui rejoint l'équipe (ou enrôle un
// nouveau pair NetBird) après la création de l'instance, ou qui la quitte, doit voir son accès évoluer sans attendre
// la prochaine réconciliation du Service.
// Implémente manager.Runnable (pas d'élection de leader : un seul replica).
type MembershipSyncer struct {
	Client   client.Reader
	NB       NetBird
	Members  Members
	Cfg      Config
	Log      *slog.Logger
	Interval time.Duration
}

// NeedLeaderElection : un seul replica, pas d'élection.
func (m *MembershipSyncer) NeedLeaderElection() bool { return false }

// Start boucle jusqu'à l'arrêt du contexte.
func (m *MembershipSyncer) Start(ctx context.Context) error {
	interval := m.Interval
	if interval <= 0 {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if err := m.SyncOnce(ctx); err != nil {
			reconcileErrors.Inc()
			m.Log.Error("synchronisation des membres en erreur", "err", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
	}
}

// SyncOnce synchronise les groupes de toutes les équipes ayant un namespace d'instance.
func (m *MembershipSyncer) SyncOnce(ctx context.Context) error {
	var nss corev1.NamespaceList
	if err := m.Client.List(ctx, &nss); err != nil {
		return err
	}
	teams := map[string]bool{}
	for _, ns := range nss.Items {
		if strings.HasPrefix(ns.Name, m.Cfg.NamespacePrefix) && ns.DeletionTimestamp.IsZero() {
			if t := ns.Labels[TeamLabel]; t != "" {
				teams[t] = true
			}
		}
	}
	if len(teams) == 0 {
		return nil
	}
	if err := GuardOpenPolicies(ctx, m.NB); err != nil {
		return err
	}
	ids := make([]string, 0, len(teams))
	for t := range teams {
		ids = append(ids, t)
	}
	sort.Strings(ids)
	var firstErr error
	for _, team := range ids {
		groupID, err := m.NB.EnsureGroup(ctx, m.Cfg.TeamGroupPrefix+team)
		if err == nil {
			err = SyncTeamGroup(ctx, m.NB, m.Members, m.Log, groupID, team)
		}
		if err != nil {
			m.Log.Error("équipe non synchronisée", "team", team, "err", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}
