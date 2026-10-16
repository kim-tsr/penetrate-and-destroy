// Package ctfd est un client minimal de l'endpoint interne de CTFd (plugin pad_teams) qui donne les membres d'une
// équipe : GET /api/v1/pad/internal/sources/team/<id>, authentifié par un jeton de service (Bearer).
package ctfd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Client interroge CTFd depuis le cluster (ClusterIP, pas de passage par l'edge).
type Client struct {
	base  string
	token string
	http  *http.Client
}

// New construit un client. baseURL : http://ctfd.ctfd.svc.cluster.local:8000 (contrat apps.ctfd.service).
func New(baseURL, token string, hc *http.Client) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("ctfd: URL invalide %q", baseURL)
	}
	if token == "" {
		return nil, errors.New("ctfd: jeton interne vide")
	}
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{base: u.String(), token: token, http: hc}, nil
}

type sourceResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Banned  bool `json:"banned"`
		Members []struct {
			ID    int    `json:"id"`
			Email string `json:"email"`
		} `json:"members"`
	} `json:"data"`
}

// TeamEmails renvoie les e-mails (minuscules, triés, sans doublon) des membres non bannis de l'équipe.
// Une équipe inconnue (404) ou bannie n'a aucun membre : l'accès à ses instances est retiré (échec fermé).
func (c *Client) TeamEmails(ctx context.Context, teamID string) ([]string, error) {
	id, err := strconv.Atoi(teamID)
	if err != nil || id < 1 {
		return nil, fmt.Errorf("ctfd: identifiant d'équipe invalide %q", teamID)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/api/v1/pad/internal/sources/team/%d", c.base, id), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, nil
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return nil, fmt.Errorf("ctfd: équipe %d: HTTP %d", id, resp.StatusCode)
	}
	var out sourceResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("ctfd: réponse illisible: %w", err)
	}
	if !out.Success {
		return nil, fmt.Errorf("ctfd: équipe %d: réponse en échec", id)
	}
	if out.Data.Banned {
		return nil, nil
	}
	seen := map[string]bool{}
	var emails []string
	for _, m := range out.Data.Members {
		e := strings.ToLower(strings.TrimSpace(m.Email))
		if e != "" && !seen[e] {
			seen[e] = true
			emails = append(emails, e)
		}
	}
	sort.Strings(emails)
	return emails, nil
}
