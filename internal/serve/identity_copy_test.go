package serve_test

import (
	"net/http"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

var identityCopyEndpoints = []struct {
	path, body, method, params string
	result                     any
}{
	{"/api/v1/identities/copy/begin", "", rpc.MethodIdentityCopyBegin, `{}`, rpc.IdentityCopyBegin{CopyID: "c-test", PublicKey: "AAAA"}},
	{"/api/v1/identities/bot/export", `{"public_key":"AAAA"}`, rpc.MethodIdentityExport, `{"name":"bot","public_key":"AAAA"}`, rpc.IdentityExport{Bundle: "BBBB"}},
	{"/api/v1/identities/copy/c-test", `{"bundle":"BBBB"}`, rpc.MethodIdentityImport, `{"copy_id":"c-test","bundle":"BBBB"}`, rpc.EnvInfo{Name: "bot"}},
}

func TestServeIdentityCopyRoutesCallTheDaemonForTheOwner(t *testing.T) {
	for _, c := range identityCopyEndpoints {
		f := newFakeDaemon()
		f.devices[goodToken] = phone
		f.results[c.method] = c.result
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, "POST", c.path, goodToken, c.body)
		if status != http.StatusOK {
			t.Fatalf("%s: status %d %s", c.path, status, out)
		}
		if params := f.paramsOf(c.method); len(params) != 1 || string(params[0]) != c.params {
			t.Fatalf("%s: params %s", c.path, params)
		}
	}
}

func TestServeIdentityCopyRoutesAreForbiddenToADeviceThatIsNotTheOwner(t *testing.T) {
	for _, c := range identityCopyEndpoints {
		f := newFakeDaemon()
		f.devices[goodToken] = phone
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, "POST", c.path, goodToken, c.body, "X-Forwarded-For", "100.91.145.6")
		if status != http.StatusForbidden || errorCode(t, out) != "forbidden" {
			t.Fatalf("%s: status %d %s", c.path, status, out)
		}
		if len(f.paramsOf(c.method)) != 0 {
			t.Fatalf("%s: the daemon got the call", c.path)
		}
	}
}

func TestServeIdentityRoutesStillWorkNextToTheCopyRoutes(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodIdentitySetSecret] = rpc.EnvInfo{Name: "bot"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "POST", "/api/v1/identities/bot/secret", goodToken, `{"secret":"GH_TOKEN","value":"TEST-v"}`, "X-Forwarded-For", "100.91.145.6")
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, out)
	}
}
