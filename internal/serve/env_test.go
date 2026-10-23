package serve_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

const serveEnvSecret = "TEST-zzserveenvzz"

func TestServeEnvRoutesCallTheDaemon(t *testing.T) {
	for _, c := range []struct {
		verb, path, body, method, params string
	}{
		{"GET", "/api/v1/envs", "", rpc.MethodEnvList, `{}`},
		{"POST", "/api/v1/envs", `{"name":"bot","kind":"custom","parts":["git"],"git_name":"Bot","git_email":"bot@example.com"}`, rpc.MethodEnvCreate, `{"name":"bot","kind":"custom","parts":["git"],"git_name":"Bot","git_email":"bot@example.com"}`},
		{"GET", "/api/v1/envs/bot", "", rpc.MethodEnvShow, `{"name":"bot"}`},
		{"POST", "/api/v1/envs/bot", `{"name":"other","secret":"GH_TOKEN","value":"` + serveEnvSecret + `"}`, rpc.MethodEnvSet, `{"name":"bot","secret":"GH_TOKEN","value":"` + serveEnvSecret + `"}`},
		{"POST", "/api/v1/envs/bot/unset", `{"secret":"GH_TOKEN"}`, rpc.MethodEnvUnset, `{"name":"bot","secret":"GH_TOKEN"}`},
		{"DELETE", "/api/v1/envs/bot", "", rpc.MethodEnvDelete, `{"name":"bot"}`},
		{"GET", "/api/v1/envs/bot/ssh-key", "", rpc.MethodEnvSSHKey, `{"name":"bot"}`},
		{"POST", "/api/v1/envs/bot/ssh-key", `{"action":"rotate"}`, rpc.MethodEnvSSHKey, `{"name":"bot","action":"rotate"}`},
	} {
		f := newFakeDaemon()
		f.devices[goodToken] = phone
		f.results[c.method] = rpc.EnvInfo{Name: "bot", Kind: domain.EnvCustom, Secrets: []rpc.EnvSecret{{Name: "GH_TOKEN", Set: true}}}
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, c.verb, c.path, goodToken, c.body)
		if status != http.StatusOK {
			t.Fatalf("%s %s: status %d %s", c.verb, c.path, status, out)
		}
		if strings.Contains(string(out), "zzserveenvzz") {
			t.Fatalf("%s %s: the response holds the secret: %s", c.verb, c.path, out)
		}
		params := f.paramsOf(c.method)
		if len(params) != 1 || string(params[0]) != c.params {
			t.Fatalf("%s %s: params %s", c.verb, c.path, params)
		}
	}
}

func TestServeEnvRoutesNeedAToken(t *testing.T) {
	f := newFakeDaemon()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	if status, _ := do(t, ts, "POST", "/api/v1/envs/bot", "", `{"secret":"GH_TOKEN","value":"`+serveEnvSecret+`"}`); status != http.StatusUnauthorized {
		t.Fatalf("status %d", status)
	}
	if len(f.paramsOf(rpc.MethodEnvSet)) != 0 {
		t.Fatal("the daemon got the call")
	}
}
