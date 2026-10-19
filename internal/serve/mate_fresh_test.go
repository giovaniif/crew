package serve_test

import (
	"net/http"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

func TestServeMateFreshCallsTheDaemon(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "POST", "/api/v1/sessions/s1/fresh", goodToken, `{"same_worktree":true,"session":"other"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	if params := f.paramsOf(rpc.MethodMateFresh); len(params) != 1 || string(params[0]) != `{"session":"s1","same_worktree":true}` {
		t.Fatalf("params %s", params)
	}
}
