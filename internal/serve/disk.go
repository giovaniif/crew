package serve

import (
	"net/http"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

type DiskPort struct {
	Port     int    `json:"port"`
	PGID     int    `json:"pgid"`
	Command  string `json:"command"`
	Worktree string `json:"worktree"`
	Session  string `json:"session"`
}

type Disk struct {
	rpc.DiskView
	Ports []DiskPort `json:"ports"`
}

func diskView(r *http.Request, d Daemon) (any, error) {
	var view rpc.DiskView
	if err := d.Call(r.Context(), rpc.MethodDiskView, nil, &view); err != nil {
		return nil, err
	}
	if view.Rows == nil {
		view.Rows = []domain.DiskRow{}
	}
	if view.Recent == nil {
		view.Recent = []rpc.RecentCleanup{}
	}
	sub, err := d.Subscribe(r.Context())
	if err != nil {
		return nil, err
	}
	out := Disk{DiskView: view, Ports: []DiskPort{}}
	for _, w := range sub.State.Worktrees {
		for _, p := range w.Ports {
			out.Ports = append(out.Ports, DiskPort{Port: p.Port, PGID: p.PGID, Command: p.Command, Worktree: w.Path, Session: w.SessionID})
		}
	}
	return out, nil
}

func cleanupWorktree(r *http.Request, d Daemon) (any, error) {
	var p rpc.CleanupWorktreeParams
	if err := decodeOne(r, &p, "path and backup"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.Path) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "path is empty"}
	}
	var out rpc.CleanupItem
	if err := d.Call(r.Context(), rpc.MethodCleanupWorktree, p, &out); err != nil {
		return nil, err
	}
	return out, nil
}

type cleanupRunResult struct {
	Items []rpc.CleanupItem `json:"items"`
}

func cleanupRun(r *http.Request, d Daemon) (any, error) {
	var items []rpc.CleanupItem
	if err := d.Call(r.Context(), rpc.MethodCleanupRun, nil, &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []rpc.CleanupItem{}
	}
	return cleanupRunResult{Items: items}, nil
}

func killPorts(r *http.Request, d Daemon) (any, error) {
	var p rpc.PortsKillParams
	if err := decodeOne(r, &p, "pgids"); err != nil {
		return nil, err
	}
	if len(p.PGIDs) == 0 {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "pgids is empty"}
	}
	var out rpc.PortsKilled
	if err := d.Call(r.Context(), rpc.MethodPortsKill, p, &out); err != nil {
		return nil, err
	}
	if out.Killed == nil {
		out.Killed = []int{}
	}
	return out, nil
}
