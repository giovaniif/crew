package serve_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

func diskFake() *fakeDaemon {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	next := time.Date(2026, 10, 20, 14, 30, 0, 0, time.UTC)
	f.results[rpc.MethodDiskView] = rpc.DiskView{
		Free: 61_400_000_000, Total: 494_000_000_000, AutoCleanEvery: 10 * time.Minute, NextCleanup: &next,
		DepsStore: &rpc.DepsStore{Path: "/home/me/.local/share/pnpm/store", Size: 3_100_000_000},
		Rows: []domain.DiskRow{
			{WorktreeID: "w1", Size: 412_000_000, Action: domain.CleanupKeep, Reason: "its session is live"},
			{WorktreeID: "w2", Size: domain.SizePending, Action: domain.CleanupRemove, Reason: "PR #77 merged"},
		},
		Recent:      []rpc.RecentCleanup{{At: next.Add(-time.Hour), Path: "/w/api-old", Branch: "old", Action: domain.CleanupRemove, Outcome: "removed"}},
		Reclaimable: 0, ReclaimablePending: 1, WorktreesSize: 412_000_000, WorktreesPending: 1,
	}
	f.state = rpc.State{
		Worktrees: []domain.Worktree{
			{ID: "w1", Repo: "api", Path: "/w/api-feat", Branch: "feat", SessionID: "s1", Ports: []domain.Port{{Port: 5173, PID: 42, PGID: 40, Command: "node"}}},
			{ID: "w2", Repo: "web", Path: "/w/web-old", Branch: "old"},
		},
	}
	return f
}

func TestServeDiskViewAddsThePortsOfTheWorktrees(t *testing.T) {
	f := diskFake()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "GET", "/api/v1/disk", goodToken, "")
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	golden(t, "disk.json", out)
}

func TestServeCleanupWorktreePassesPathAndBackup(t *testing.T) {
	f := diskFake()
	f.results[rpc.MethodCleanupWorktree] = rpc.CleanupItem{Path: "/w/web-old", Branch: "old", Action: domain.CleanupBackupThenAsk, Reason: "2 uncommitted changes", Outcome: "backed up, removed"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "POST", "/api/v1/cleanup/worktree", goodToken, `{"path":"/w/web-old","backup":true}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	golden(t, "cleanup-worktree.json", out)
	params := f.paramsOf(rpc.MethodCleanupWorktree)
	if len(params) != 1 || string(params[0]) != `{"path":"/w/web-old","backup":true}` {
		t.Fatalf("params %s", params)
	}
}

func TestServeCleanupWorktreeRefusesABlankPathOrOtherKeys(t *testing.T) {
	for _, body := range []string{`{"path":" "}`, `{"path":"/w/x","force":true}`, ``} {
		f := diskFake()
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, "POST", "/api/v1/cleanup/worktree", goodToken, body)
		if status != http.StatusBadRequest {
			t.Fatalf("%q: status %d %s", body, status, out)
		}
		if params := f.paramsOf(rpc.MethodCleanupWorktree); len(params) != 0 {
			t.Fatalf("%q: params %s", body, params)
		}
	}
}

func TestServeKillsPortsByProcessGroup(t *testing.T) {
	f := diskFake()
	f.results[rpc.MethodPortsKill] = rpc.PortsKilled{Killed: []int{40}}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "POST", "/api/v1/ports/kill", goodToken, `{"pgids":[40]}`)
	if status != http.StatusOK || string(out) != "{\"killed\":[40]}\n" {
		t.Fatalf("status %d %q", status, out)
	}
	params := f.paramsOf(rpc.MethodPortsKill)
	if len(params) != 1 || string(params[0]) != `{"pgids":[40]}` {
		t.Fatalf("params %s", params)
	}
}

func TestServeCleanupAndKillAreOnlyForTheOwnerDevice(t *testing.T) {
	f := diskFake()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, ep := range []authedEndpoint{
		{"POST", "/api/v1/cleanup/worktree", `{"path":"/w/web-old","backup":true}`},
		{"POST", "/api/v1/ports/kill", `{"pgids":[40]}`},
	} {
		status, out := do(t, ts, ep.method, ep.path, goodToken, ep.body, "X-Forwarded-For", "100.91.145.6")
		if status != http.StatusForbidden || errorCode(t, out) != "forbidden" {
			t.Fatalf("%s %s from a remote phone: status %d %s", ep.method, ep.path, status, out)
		}
	}
	if len(f.paramsOf(rpc.MethodCleanupWorktree)) != 0 || len(f.paramsOf(rpc.MethodPortsKill)) != 0 {
		t.Fatalf("a remote phone reached the daemon: %v", f.methods())
	}
}

func TestServeKillPortsRefusesNoProcessGroups(t *testing.T) {
	f := diskFake()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	if status, out := do(t, ts, "POST", "/api/v1/ports/kill", goodToken, `{"pgids":[]}`); status != http.StatusBadRequest {
		t.Fatalf("status %d %s", status, out)
	}
	if params := f.paramsOf(rpc.MethodPortsKill); len(params) != 0 {
		t.Fatalf("params %s", params)
	}
}
