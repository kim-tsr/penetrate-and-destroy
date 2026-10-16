package ctfd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func serve(t *testing.T, status int, body string, seen *http.Request) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = *r
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	c, err := New(srv.URL, "tok", srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestTeamEmails(t *testing.T) {
	var req http.Request
	c := serve(t, 200, `{"success":true,"data":{"kind":"team","id":7,"banned":false,"members":[
		{"id":1,"email":"Alice@Example.test"},{"id":2,"email":"bob@example.test"},{"id":3,"email":"alice@example.test"},{"id":4,"email":""}]}}`, &req)
	got, err := c.TeamEmails(context.Background(), "7")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "alice@example.test,bob@example.test" {
		t.Fatalf("e-mails: %v", got)
	}
	if req.URL.Path != "/api/v1/pad/internal/sources/team/7" {
		t.Fatalf("chemin: %s", req.URL.Path)
	}
}

func TestTeamEmailsBannedOrMissingIsEmpty(t *testing.T) {
	banned := serve(t, 200, `{"success":true,"data":{"banned":true,"members":[{"id":1,"email":"a@example.test"}]}}`, nil)
	if got, err := banned.TeamEmails(context.Background(), "7"); err != nil || len(got) != 0 {
		t.Fatalf("équipe bannie: %v %v", got, err)
	}
	gone := serve(t, 404, `{}`, nil)
	if got, err := gone.TeamEmails(context.Background(), "7"); err != nil || len(got) != 0 {
		t.Fatalf("équipe absente: %v %v", got, err)
	}
}

func TestTeamEmailsErrors(t *testing.T) {
	c := serve(t, 500, `boom`, nil)
	if _, err := c.TeamEmails(context.Background(), "7"); err == nil {
		t.Fatal("erreur HTTP attendue")
	}
	bad := serve(t, 200, `pas du json`, nil)
	if _, err := bad.TeamEmails(context.Background(), "7"); err == nil {
		t.Fatal("réponse illisible: erreur attendue")
	}
	for _, id := range []string{"", "x", "-1", "0", "7/../8", "7?x=1"} {
		if _, err := c.TeamEmails(context.Background(), id); err == nil || strings.Contains(err.Error(), "HTTP") {
			t.Errorf("identifiant %q doit être refusé avant tout appel: %v", id, err)
		}
	}
}

func TestNewValidates(t *testing.T) {
	if _, err := New("", "tok", nil); err == nil {
		t.Error("URL vide")
	}
	if _, err := New("http://ctfd:8000", "", nil); err == nil {
		t.Error("jeton vide")
	}
}
