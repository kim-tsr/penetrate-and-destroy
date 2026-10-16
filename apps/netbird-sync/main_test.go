package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/kim-tsr/penetrate-and-destroy/apps/netbird-sync/internal/controller"
)

// stubNB ne sert qu'à OpenPolicies ; les autres méthodes ne sont pas appelées par le garde-fou.
type stubNB struct {
	controller.NetBird
	calls int
	fail  int // nombre d'appels qui échouent avant de répondre
	open  []string
}

func (s *stubNB) OpenPolicies(context.Context) ([]string, error) {
	s.calls++
	if s.calls <= s.fail {
		return nil, errors.New("API injoignable")
	}
	return s.open, nil
}

var quiet = slog.New(slog.NewJSONHandler(io.Discard, nil))

func TestStartupRefusesOpenPolicy(t *testing.T) {
	nb := &stubNB{open: []string{"Default"}}
	err := waitNoOpenPolicy(context.Background(), nb, quiet, 5, time.Millisecond)
	if !errors.Is(err, controller.ErrOpenPolicy) {
		t.Fatalf("refus attendu: %v", err)
	}
	if nb.calls != 1 {
		t.Fatalf("une policy ouverte est définitive, pas de nouvel essai: %d appels", nb.calls)
	}
}

func TestStartupRetriesUnreachableAPI(t *testing.T) {
	nb := &stubNB{fail: 2}
	if err := waitNoOpenPolicy(context.Background(), nb, quiet, 5, time.Millisecond); err != nil {
		t.Fatalf("démarrage attendu après reprise de l'API: %v", err)
	}
	if nb.calls != 3 {
		t.Fatalf("appels: %d", nb.calls)
	}
	down := &stubNB{fail: 100}
	if err := waitNoOpenPolicy(context.Background(), down, quiet, 3, time.Millisecond); err == nil {
		t.Fatal("API toujours injoignable: échec attendu")
	}
}
