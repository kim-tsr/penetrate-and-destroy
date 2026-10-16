// Package netbird est un client minimal de l'API REST de management NetBird
// (groupes, networks, network resources, policies). Auth : "Authorization: Token <PAT>".
package netbird

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// ErrNotFound est renvoyée pour un 404.
var ErrNotFound = errors.New("netbird: not found")

// Client appelle l'API NetBird (baseURL se termine par /api).
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// New construit un client. apiURL accepte "https://vpn.example.net" ou ".../api".
func New(apiURL, token string, hc *http.Client) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(apiURL, "/"))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("netbird: URL d'API invalide %q", apiURL)
	}
	if !strings.HasSuffix(u.Path, "/api") {
		u.Path += "/api"
	}
	if token == "" {
		return nil, errors.New("netbird: token vide")
	}
	if hc == nil {
		hc = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{baseURL: u.String(), token: token, http: hc}, nil
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Token "+c.token)
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("netbird: %s %s: HTTP %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

type idName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type wireID struct {
	ID string `json:"id"`
}

// EnsureGroup renvoie l'ID du groupe `name`, en le créant s'il est absent.
func (c *Client) EnsureGroup(ctx context.Context, name string) (string, error) {
	var groups []idName
	if err := c.do(ctx, http.MethodGet, "/groups?name="+url.QueryEscape(name), nil, &groups); err != nil {
		return "", err
	}
	for _, g := range groups {
		if g.Name == name {
			return g.ID, nil
		}
	}
	var g idName
	if err := c.do(ctx, http.MethodPost, "/groups", map[string]string{"name": name}, &g); err != nil {
		return "", err
	}
	return g.ID, nil
}

// EnsureNetwork renvoie l'ID du network `name`, en le créant s'il est absent.
func (c *Client) EnsureNetwork(ctx context.Context, name string) (string, error) {
	var nets []idName
	if err := c.do(ctx, http.MethodGet, "/networks", nil, &nets); err != nil {
		return "", err
	}
	for _, n := range nets {
		if n.Name == name {
			return n.ID, nil
		}
	}
	var n idName
	req := map[string]string{"name": name, "description": "Géré par netbird-sync"}
	if err := c.do(ctx, http.MethodPost, "/networks", req, &n); err != nil {
		return "", err
	}
	return n.ID, nil
}

// Resource décrit une network resource de type host.
type Resource struct {
	Name        string
	Description string
	Address     string // IP/32
	GroupIDs    []string
}

type resourceWire struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Address     string   `json:"address"`
	Enabled     bool     `json:"enabled"`
	Groups      []wireID `json:"groups"`
}

type resourceReq struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Address     string   `json:"address"`
	Enabled     bool     `json:"enabled"`
	Groups      []string `json:"groups"`
}

// UpsertResource crée ou met à jour (si divergent) la resource `r.Name` du network.
// Renvoie l'ID. Aucune écriture si l'état est déjà conforme.
func (c *Client) UpsertResource(ctx context.Context, networkID string, r Resource) (string, error) {
	base := "/networks/" + url.PathEscape(networkID) + "/resources"
	var list []resourceWire
	if err := c.do(ctx, http.MethodGet, base, nil, &list); err != nil {
		return "", err
	}
	req := resourceReq{Name: r.Name, Description: r.Description, Address: r.Address, Enabled: true, Groups: r.GroupIDs}
	for _, e := range list {
		if e.Name != r.Name {
			continue
		}
		var have []string
		for _, g := range e.Groups {
			have = append(have, g.ID)
		}
		if e.Enabled && sameAddr(e.Address, r.Address) && sameSet(have, r.GroupIDs) && e.Description == r.Description {
			return e.ID, nil
		}
		if err := c.do(ctx, http.MethodPut, base+"/"+url.PathEscape(e.ID), req, nil); err != nil {
			return "", err
		}
		return e.ID, nil
	}
	var out resourceWire
	if err := c.do(ctx, http.MethodPost, base, req, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

// DeleteResource supprime la resource par nom ; absente = succès.
func (c *Client) DeleteResource(ctx context.Context, networkID, name string) error {
	base := "/networks/" + url.PathEscape(networkID) + "/resources"
	var list []resourceWire
	if err := c.do(ctx, http.MethodGet, base, nil, &list); err != nil {
		return err
	}
	for _, e := range list {
		if e.Name == name {
			if err := c.do(ctx, http.MethodDelete, base+"/"+url.PathEscape(e.ID), nil, nil); err != nil && !errors.Is(err, ErrNotFound) {
				return err
			}
		}
	}
	return nil
}

// PortSet regroupe les ports d'un protocole (tcp|udp) ; chaque port est "80" ou une plage "8000-8100".
type PortSet struct {
	Protocol string
	Ports    []string
}

// Policy est la policy désirée : groupe source -> resource, ports par protocole.
type Policy struct {
	Name        string
	Description string
	SourceGroup string
	ResourceID  string
	Rules       []PortSet
}

type resourceRef struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type ruleWire struct {
	Enabled             bool         `json:"enabled"`
	Action              string       `json:"action"`
	Bidirectional       bool         `json:"bidirectional"`
	Protocol            string       `json:"protocol"`
	Ports               []string     `json:"ports"`
	Sources             []wireID     `json:"sources"`
	Destinations        []wireID     `json:"destinations"`
	DestinationResource *resourceRef `json:"destinationResource"`
}

type policyWire struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Enabled     bool       `json:"enabled"`
	Rules       []ruleWire `json:"rules"`
}

type ruleReq struct {
	Name                string      `json:"name"`
	Enabled             bool        `json:"enabled"`
	Action              string      `json:"action"`
	Bidirectional       bool        `json:"bidirectional"`
	Protocol            string      `json:"protocol"`
	Ports               []string    `json:"ports"`
	Sources             []string    `json:"sources"`
	DestinationResource resourceRef `json:"destinationResource"`
}

type policyReq struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	Rules       []ruleReq `json:"rules"`
}

func (p Policy) request() policyReq {
	req := policyReq{Name: p.Name, Description: p.Description, Enabled: true}
	for _, rs := range p.Rules {
		req.Rules = append(req.Rules, ruleReq{
			Name: p.Name + "-" + rs.Protocol, Enabled: true, Action: "accept", Bidirectional: false,
			Protocol: rs.Protocol, Ports: rs.Ports, Sources: []string{p.SourceGroup},
			DestinationResource: resourceRef{ID: p.ResourceID, Type: "host"},
		})
	}
	return req
}

func policyMatches(have policyWire, want policyReq) bool {
	if !have.Enabled || have.Description != want.Description || len(have.Rules) != len(want.Rules) {
		return false
	}
	for _, w := range want.Rules {
		ok := false
		for _, h := range have.Rules {
			var src []string
			for _, s := range h.Sources {
				src = append(src, s.ID)
			}
			if h.Enabled && h.Action == "accept" && !h.Bidirectional && h.Protocol == w.Protocol &&
				sameSet(h.Ports, w.Ports) && sameSet(src, w.Sources) && len(h.Destinations) == 0 &&
				h.DestinationResource != nil && h.DestinationResource.ID == w.DestinationResource.ID {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// UpsertPolicy crée ou met à jour la policy par nom (idempotent).
func (c *Client) UpsertPolicy(ctx context.Context, p Policy) error {
	var list []policyWire
	if err := c.do(ctx, http.MethodGet, "/policies", nil, &list); err != nil {
		return err
	}
	req := p.request()
	for _, e := range list {
		if e.Name != p.Name {
			continue
		}
		if policyMatches(e, req) {
			return nil
		}
		return c.do(ctx, http.MethodPut, "/policies/"+url.PathEscape(e.ID), req, nil)
	}
	return c.do(ctx, http.MethodPost, "/policies", req, nil)
}

// DeletePolicy supprime la policy par nom ; absente = succès.
func (c *Client) DeletePolicy(ctx context.Context, name string) error {
	var list []policyWire
	if err := c.do(ctx, http.MethodGet, "/policies", nil, &list); err != nil {
		return err
	}
	for _, e := range list {
		if e.Name == name {
			if err := c.do(ctx, http.MethodDelete, "/policies/"+url.PathEscape(e.ID), nil, nil); err != nil && !errors.Is(err, ErrNotFound) {
				return err
			}
		}
	}
	return nil
}

func sameAddr(a, b string) bool {
	return strings.TrimSuffix(a, "/32") == strings.TrimSuffix(b, "/32")
}

func sameSet(a, b []string) bool {
	x, y := slices.Clone(a), slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}
