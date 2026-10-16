package netbird

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// AllGroupName est le groupe implicite auquel NetBird rattache tous les pairs.
const AllGroupName = "All"

type policyRuleSources struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Sources []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"sources"`
}

type policyWithSources struct {
	Name    string              `json:"name"`
	Enabled bool                `json:"enabled"`
	Rules   []policyRuleSources `json:"rules"`
}

// OpenPolicies renvoie le nom des policies actives dont au moins une règle active a le groupe « All » en source.
// C'est le cas de la policy « Default » créée par NetBird (All <-> All) : tant qu'elle existe, tout joueur enrôlé
// atteint tous les pairs et toutes les routes, et l'isolation par équipe n'a aucun effet.
func (c *Client) OpenPolicies(ctx context.Context) ([]string, error) {
	var groups []idName
	if err := c.do(ctx, http.MethodGet, "/groups?name="+url.QueryEscape(AllGroupName), nil, &groups); err != nil {
		return nil, err
	}
	allID := ""
	for _, g := range groups {
		if g.Name == AllGroupName {
			allID = g.ID
		}
	}
	var policies []policyWithSources
	if err := c.do(ctx, http.MethodGet, "/policies", nil, &policies); err != nil {
		return nil, err
	}
	var open []string
	for _, p := range policies {
		if !p.Enabled {
			continue
		}
	rules:
		for _, r := range p.Rules {
			if !r.Enabled {
				continue
			}
			for _, s := range r.Sources {
				if s.Name == AllGroupName || (allID != "" && s.ID == allID) {
					open = append(open, p.Name)
					break rules
				}
			}
		}
	}
	slices.Sort(open)
	return open, nil
}

type userWire struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Role          string `json:"role"`
	IsServiceUser bool   `json:"is_service_user"`
	IsBlocked     bool   `json:"is_blocked"`
}

type peerWire struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
}

type groupWire struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Peers []wireID `json:"peers"`
}

type groupReq struct {
	Name  string   `json:"name"`
	Peers []string `json:"peers"`
}

// SyncGroupMembers ajuste les pairs du groupe `groupID` pour qu'il contienne exactement les pairs des utilisateurs
// NetBird dont l'e-mail figure dans `emails` (comparaison insensible à la casse ; comptes de service et utilisateurs
// bloqués ignorés). Les pairs d'un joueur qui a quitté l'équipe sont retirés. Aucune écriture si l'état est conforme.
// Renvoie le nombre de pairs ajoutés et retirés.
//
// Le groupe d'équipe est la source des policies d'instance : un pair qui y entre atteint les instances de l'équipe,
// et seulement elles (jamais d'accès via la policy « Default » : voir OpenPolicies).
func (c *Client) SyncGroupMembers(ctx context.Context, groupID string, emails []string) (added, removed int, err error) {
	want := map[string]bool{}
	for _, e := range emails {
		want[strings.ToLower(strings.TrimSpace(e))] = true
	}
	var users []userWire
	if err := c.do(ctx, http.MethodGet, "/users", nil, &users); err != nil {
		return 0, 0, err
	}
	wantUsers := map[string]bool{}
	for _, u := range users {
		if u.IsServiceUser || u.IsBlocked || u.Email == "" {
			continue
		}
		if want[strings.ToLower(u.Email)] {
			wantUsers[u.ID] = true
		}
	}
	var peers []peerWire
	if err := c.do(ctx, http.MethodGet, "/peers", nil, &peers); err != nil {
		return 0, 0, err
	}
	wantPeers := []string{}
	for _, p := range peers {
		if p.UserID != "" && wantUsers[p.UserID] {
			wantPeers = append(wantPeers, p.ID)
		}
	}
	slices.Sort(wantPeers)

	var g groupWire
	if err := c.do(ctx, http.MethodGet, "/groups/"+url.PathEscape(groupID), nil, &g); err != nil {
		return 0, 0, err
	}
	have := make([]string, 0, len(g.Peers))
	for _, p := range g.Peers {
		have = append(have, p.ID)
	}
	slices.Sort(have)
	if slices.Equal(have, wantPeers) {
		return 0, 0, nil
	}
	for _, id := range wantPeers {
		if !slices.Contains(have, id) {
			added++
		}
	}
	for _, id := range have {
		if !slices.Contains(wantPeers, id) {
			removed++
		}
	}
	if g.Name == "" {
		return 0, 0, fmt.Errorf("netbird: groupe %s sans nom", groupID)
	}
	if err := c.do(ctx, http.MethodPut, "/groups/"+url.PathEscape(groupID), groupReq{Name: g.Name, Peers: wantPeers}, nil); err != nil {
		return 0, 0, err
	}
	return added, removed, nil
}
