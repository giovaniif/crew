package serve

import (
	"net/http"
	"slices"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func switchParams(r *http.Request, id string) (any, error) {
	var body struct {
		Kind  domain.SwitchKind `json:"kind"`
		Value string            `json:"value"`
	}
	if err := decodeOne(r, &body, "kind and value"); err != nil {
		return nil, err
	}
	if body.Kind != domain.SwitchModel && body.Kind != domain.SwitchEffort {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: `kind must be "model" or "effort"`}
	}
	if strings.TrimSpace(body.Value) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "send a value to switch to"}
	}
	return rpc.SwitchParams{SessionID: id, Kind: body.Kind, Value: body.Value}, nil
}

func killDevServers(r *http.Request, d Daemon) (any, error) {
	sub, err := d.Subscribe(r.Context())
	if err != nil {
		return nil, err
	}
	pgids := devServers(sub.State.Worktrees, r.PathValue("id"))
	if len(pgids) == 0 {
		return rpc.PortsKilled{Killed: []int{}}, nil
	}
	var out rpc.PortsKilled
	if err := d.Call(r.Context(), rpc.MethodPortsKill, rpc.PortsKillParams{PGIDs: pgids}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func devServers(worktrees []domain.Worktree, session string) []int {
	var pgids []int
	for _, wt := range worktrees {
		if wt.SessionID != session {
			continue
		}
		for _, p := range wt.Ports {
			if !slices.Contains(pgids, p.PGID) {
				pgids = append(pgids, p.PGID)
			}
		}
	}
	slices.Sort(pgids)
	return pgids
}
