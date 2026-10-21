package serve_test

import (
	"net/http"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

func TestServeSwitchSendsTheKindAndValueOfTheSession(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodSwitch] = domain.Session{ID: "s1", TaskID: "t1", Harness: domain.HarnessClaude, State: domain.StateIdle, Model: "opus"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/switch", goodToken, `{"kind":"model","value":"opus"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	params := f.paramsOf(rpc.MethodSwitch)
	if len(params) != 1 || string(params[0]) != `{"session_id":"s1","kind":"model","value":"opus"}` {
		t.Fatalf("switch params %s", params)
	}
	golden(t, "session-switch.json", body)
}

func TestServeSwitchRefusesABadKindOrABlankValue(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, b := range []string{`{"kind":"harness","value":"codex"}`, `{"kind":"effort","value":"  "}`, `{"value":"opus"}`, `{"kind":"model","value":"opus","id":"s2"}`} {
		status, body := do(t, ts, "POST", "/api/v1/sessions/s1/switch", goodToken, b)
		if status != http.StatusBadRequest || errorCode(t, body) != rpc.CodeBadRequest {
			t.Fatalf("%s: status %d %s", b, status, body)
		}
	}
	if len(f.paramsOf(rpc.MethodSwitch)) != 0 {
		t.Fatal("a bad body reached session.switch")
	}
}

func TestServeKillDevServersKillsTheProcessGroupsOfTheSessionsWorktrees(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.state = rpc.State{Worktrees: []domain.Worktree{
		{ID: "w1", SessionID: "s1", Ports: []domain.Port{{Port: 3000, PID: 7, PGID: 7}, {Port: 3001, PID: 8, PGID: 7}}},
		{ID: "w2", SessionID: "s1", Ports: []domain.Port{{Port: 5173, PID: 4, PGID: 4}}},
		{ID: "w3", SessionID: "s2", Ports: []domain.Port{{Port: 8080, PID: 9, PGID: 9}}},
	}}
	f.results[rpc.MethodPortsKill] = rpc.PortsKilled{Killed: []int{4, 7}}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/kill-dev-servers", goodToken, "")
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	params := f.paramsOf(rpc.MethodPortsKill)
	if len(params) != 1 || string(params[0]) != `{"pgids":[4,7]}` {
		t.Fatalf("ports.kill params %s", params)
	}
	golden(t, "kill-dev-servers.json", body)
}

func TestServeKillDevServersWithNoPortsKillsNothing(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.state = rpc.State{Worktrees: []domain.Worktree{{ID: "w3", SessionID: "s2", Ports: []domain.Port{{Port: 8080, PID: 9, PGID: 9}}}}}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/kill-dev-servers", goodToken, "")
	if status != http.StatusOK || string(body) != "{\"killed\":[]}\n" {
		t.Fatalf("status %d %q", status, body)
	}
	if len(f.paramsOf(rpc.MethodPortsKill)) != 0 {
		t.Fatal("serve called ports.kill with no process groups")
	}
}
