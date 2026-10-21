package serve_test

import (
	"net/http"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

var automationOwnerEndpoints = []authedEndpoint{
	{"POST", "/api/v1/automations", `{"automation":{"name":"fix-ci","agent":"claude","prompt":"Fix the CI.","on":["pr.ci_failed"],"enabled":true}}`},
	{"POST", "/api/v1/automations/runs/r7/rerun", ""},
}

func TestServeSavesAnAutomation(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodAutomationSave] = domain.Automation{Name: "fix-ci", Agent: "claude", Prompt: "Fix the CI.", On: []string{"pr.ci_failed"}, Enabled: true, Source: "/home/me/.crew/config.toml"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	ep := automationOwnerEndpoints[0]
	status, out := do(t, ts, ep.method, ep.path, goodToken, ep.body)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	want := `{"automation":{"name":"fix-ci","agent":"claude","prompt":"Fix the CI.","on":["pr.ci_failed"],"enabled":true,"source":""}}`
	if params := f.paramsOf(rpc.MethodAutomationSave); len(params) != 1 || string(params[0]) != want {
		t.Fatalf("params %s", params)
	}
	golden(t, "automation-save.json", out)
}

func TestServeRerunsAnAutomationRun(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodAutomationRun] = rpc.AutomationRunResult{
		Run:     domain.AutomationRun{ID: "r8", Automation: "fix-ci", Trigger: "rerun", Start: paired, End: paired, Outcome: domain.AutomationSucceeded, SessionID: "s9"},
		Session: domain.Session{ID: "s9"},
	}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	ep := automationOwnerEndpoints[1]
	status, out := do(t, ts, ep.method, ep.path, goodToken, ep.body)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	if params := f.paramsOf(rpc.MethodAutomationRun); len(params) != 1 || string(params[0]) != `{"rerun":"r7"}` {
		t.Fatalf("params %s", params)
	}
	golden(t, "automation-rerun.json", out)
}

func TestServeAutomationEditsAreOnlyForTheOwnerDevice(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, ep := range automationOwnerEndpoints {
		status, out := do(t, ts, ep.method, ep.path, goodToken, ep.body, "X-Forwarded-For", "100.91.145.6")
		if status != http.StatusForbidden || errorCode(t, out) != "forbidden" {
			t.Fatalf("%s %s from a remote phone: status %d %s", ep.method, ep.path, status, out)
		}
	}
	for _, m := range f.methods() {
		if m != rpc.MethodDeviceCheck && m != rpc.MethodSubscribe {
			t.Fatalf("a request from a remote phone reached %s", m)
		}
	}
}

func TestServeAutomationSaveNeedsANamedAutomation(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, body := range []string{`{}`, `{"automation":{"name":" "}}`, `{"automation":{"name":"x"},"rerun":"r1"}`} {
		if status, out := do(t, ts, "POST", "/api/v1/automations", goodToken, body); status != http.StatusBadRequest {
			t.Fatalf("%s: status %d %s", body, status, out)
		}
	}
	if len(f.paramsOf(rpc.MethodAutomationSave)) != 0 {
		t.Fatal("a refused body reached the daemon")
	}
}
