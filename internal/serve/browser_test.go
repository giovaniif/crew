package serve_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

func browserFake() *fakeDaemon {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	return f
}

func TestServeHeadlessViewPassesTheSessionAndTheFrame(t *testing.T) {
	f := browserFake()
	f.results[rpc.MethodBrowserHeadlessView] = rpc.BrowserHeadlessView{Live: true, PNG: "iVBORw0KGgo=", Width: 1280, Height: 800}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "GET", "/api/v1/sessions/s1/browser", goodToken, "")
	if status != http.StatusOK || string(out) != "{\"live\":true,\"png\":\"iVBORw0KGgo=\",\"width\":1280,\"height\":800}\n" {
		t.Fatalf("status %d %s", status, out)
	}
	params := f.paramsOf(rpc.MethodBrowserHeadlessView)
	if len(params) != 1 || string(params[0]) != `{"session":"s1"}` {
		t.Fatalf("params %s", params)
	}
}

func TestServeHeadlessViewIsNotLiveWithNoHeadlessTab(t *testing.T) {
	f := browserFake()
	f.results[rpc.MethodBrowserHeadlessView] = rpc.BrowserHeadlessView{}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "GET", "/api/v1/sessions/s1/browser", goodToken, "")
	if status != http.StatusOK || string(out) != "{\"live\":false}\n" {
		t.Fatalf("status %d %s", status, out)
	}
}

func cookieBody(t *testing.T, file string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"file": file})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestServeImportsACookieFileForTheServerBrowser(t *testing.T) {
	f := browserFake()
	f.results[rpc.MethodBrowserCookiesImport] = rpc.BrowserCookiesResult{Imported: 2, Total: 5}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	file := ".example.com\tTRUE\t/\tTRUE\t0\tsid\tabc\nexample.com\tFALSE\t/app\tFALSE\t0\tlang\ten\n"
	status, out := do(t, ts, "POST", "/api/v1/browser/cookies", goodToken, cookieBody(t, file))
	if status != http.StatusOK || string(out) != "{\"imported\":2,\"total\":5}\n" {
		t.Fatalf("status %d %s", status, out)
	}
	params := f.paramsOf(rpc.MethodBrowserCookiesImport)
	if len(params) != 1 || !strings.Contains(string(params[0]), `"name":"sid","value":"abc"`) || !strings.Contains(string(params[0]), `"name":"lang"`) {
		t.Fatalf("params %s", params)
	}
}

func TestServeRefusesACookieFileThatDoesNotParse(t *testing.T) {
	for _, body := range []string{`{"file":""}`, `{"file":"[{]"}`, `{"file":"[]","other":1}`, ``} {
		f := browserFake()
		_, ts := startServer(t, f, serve.Config{URL: publicURL})
		status, out := do(t, ts, "POST", "/api/v1/browser/cookies", goodToken, body)
		if status != http.StatusBadRequest {
			t.Fatalf("%q: status %d %s", body, status, out)
		}
		if params := f.paramsOf(rpc.MethodBrowserCookiesImport); len(params) != 0 {
			t.Fatalf("%q: params %s", body, params)
		}
	}
}

func TestServeCookieImportIsOnlyForTheOwnerDevice(t *testing.T) {
	f := browserFake()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, out := do(t, ts, "POST", "/api/v1/browser/cookies", goodToken, cookieBody(t, "example.com\tFALSE\t/\tFALSE\t0\tsid\tabc\n"), "X-Forwarded-For", "100.91.145.6")
	if status != http.StatusForbidden || errorCode(t, out) != "forbidden" {
		t.Fatalf("status %d %s", status, out)
	}
	if len(f.paramsOf(rpc.MethodBrowserCookiesImport)) != 0 {
		t.Fatalf("a remote phone reached the daemon: %v", f.methods())
	}
}
