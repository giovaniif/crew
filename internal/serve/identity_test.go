package serve_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

func TestServeEnvironmentsListsTheMachineAndTheIdentities(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodEnvironmentList] = rpc.EnvironmentList{
		Machine:    rpc.Machine{ID: "m-test-1", Name: "devbox"},
		Identities: []rpc.EnvInfo{{Name: domain.IdentityYours, Label: domain.IdentityYoursLabel, Kind: domain.EnvLocal, Secrets: []rpc.EnvSecret{}, Parts: []domain.EnvPart{}, UsedBy: []string{}}},
		Found:      &rpc.EnvLocal{GitName: "TEST Owner", GitHub: true},
	}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "GET", "/api/v1/environments", goodToken, "")
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
	golden(t, "environments.json", out)
	if got := f.paramsOf(rpc.MethodEnvironmentList); len(got) != 1 {
		t.Fatalf("calls %v", f.methods())
	}
}

func TestServeIdentityRoutesCallTheDaemon(t *testing.T) {
	for _, c := range []struct {
		verb, path, body, method, params string
	}{
		{"POST", "/api/v1/identities/bot", `{"kind":"custom","parts":["git"]}`, rpc.MethodIdentitySet, `{"name":"bot","kind":"custom","parts":["git"]}`},
		{"DELETE", "/api/v1/identities/bot", "", rpc.MethodIdentityRemove, `{"name":"bot"}`},
		{"POST", "/api/v1/identities/bot/secret", `{"secret":"GH_TOKEN","value":"` + serveEnvSecret + `"}`, rpc.MethodIdentitySetSecret, `{"name":"bot","secret":"GH_TOKEN","value":"` + serveEnvSecret + `"}`},
		{"GET", "/api/v1/identities/bot/ssh-key", "", rpc.MethodIdentitySSHKey, `{"name":"bot"}`},
		{"POST", "/api/v1/identities/bot/ssh-key", `{"action":"make"}`, rpc.MethodIdentitySSHKey, `{"name":"bot","action":"make"}`},
	} {
		f := newFakeDaemon()
		f.devices[goodToken] = phone
		f.results[c.method] = rpc.EnvInfo{Name: "bot", Kind: domain.EnvCustom}
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, c.verb, c.path, goodToken, c.body)
		if status != http.StatusOK {
			t.Fatalf("%s %s: status %d %s", c.verb, c.path, status, out)
		}
		if strings.Contains(string(out), "zzserveenvzz") {
			t.Fatalf("%s %s: the response holds the secret", c.verb, c.path)
		}
		params := f.paramsOf(c.method)
		if len(params) != 1 || string(params[0]) != c.params {
			t.Fatalf("%s %s: params %s", c.verb, c.path, params)
		}
	}
}

func TestServeMateSetPassesTheEnvironmentAndAnswersWrongMachine(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.errs[rpc.MethodMateSet] = &rpc.Error{Code: rpc.CodeWrongMachine, Message: "mate ada: machine m-other is not this machine"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	body := `{"mate":{"name":"ada","prompt":"p","agent":"claude","enabled":true},"environment":{"machine_id":"m-other","identity_id":"bot"}}`
	status, out := do(t, ts, "POST", "/api/v1/mates", goodToken, body)
	if status != http.StatusConflict {
		t.Fatalf("status %d %s", status, out)
	}
	var e struct {
		Error rpc.Error `json:"error"`
	}
	if err := json.Unmarshal(out, &e); err != nil || e.Error.Code != rpc.CodeWrongMachine {
		t.Fatalf("body %s", out)
	}
	params := f.paramsOf(rpc.MethodMateSet)
	if len(params) != 1 || !strings.Contains(string(params[0]), `"environment":{"machine_id":"m-other","identity_id":"bot"}`) {
		t.Fatalf("params %s", params)
	}
}
