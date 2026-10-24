package serve_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/serve"
)

const pairedOrigin = "https://other-mac.example.ts.net"

func request(t *testing.T, ts string, method, path, origin string, header ...string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, ts+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestServeAllowedOriginsGetCORSHeaders(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL, AllowedOrigins: []string{pairedOrigin, "http://127.0.0.1:5173"}})
	cases := []struct {
		name, method, path, origin string
		header                     []string
		status                     int
		allow                      string
	}{
		{"listed origin", "GET", "/api/v1/workspaces", pairedOrigin, []string{"Authorization", "Bearer " + goodToken}, http.StatusOK, pairedOrigin},
		{"listed origin with a default port", "GET", "/api/v1/workspaces", pairedOrigin + ":443", []string{"Authorization", "Bearer " + goodToken}, http.StatusOK, pairedOrigin},
		{"second listed origin", "GET", "/api/v1/hello", "http://127.0.0.1:5173", nil, http.StatusOK, "http://127.0.0.1:5173"},
		{"preflight of a listed origin", "OPTIONS", "/api/v1/sessions", pairedOrigin, []string{"Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "authorization, content-type"}, http.StatusNoContent, pairedOrigin},
		{"unlisted origin", "GET", "/api/v1/workspaces", "https://evil.example", []string{"Authorization", "Bearer " + goodToken}, http.StatusForbidden, ""},
		{"unlisted origin on hello", "GET", "/api/v1/hello", "https://evil.example", nil, http.StatusForbidden, ""},
		{"preflight of an unlisted origin", "OPTIONS", "/api/v1/sessions", "https://evil.example", []string{"Access-Control-Request-Method", "POST"}, http.StatusForbidden, ""},
		{"another scheme of a listed origin", "GET", "/api/v1/hello", "http://other-mac.example.ts.net", nil, http.StatusForbidden, ""},
		{"null origin", "GET", "/api/v1/hello", "null", nil, http.StatusForbidden, ""},
		{"the public URL itself", "GET", "/api/v1/hello", publicURL, nil, http.StatusOK, ""},
		{"no origin", "GET", "/api/v1/hello", "", nil, http.StatusOK, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			resp := request(t, ts.URL, c.method, c.path, c.origin, c.header...)
			if resp.StatusCode != c.status {
				t.Fatalf("status %d, want %d", resp.StatusCode, c.status)
			}
			if got := resp.Header.Get("Access-Control-Allow-Origin"); got != c.allow {
				t.Fatalf("Access-Control-Allow-Origin %q, want %q", got, c.allow)
			}
			if c.allow == "" {
				return
			}
			if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "" {
				t.Fatalf("Access-Control-Allow-Credentials %q, want none", got)
			}
			if !strings.Contains(resp.Header.Get("Vary"), "Origin") {
				t.Fatalf("Vary %q, want Origin", resp.Header.Get("Vary"))
			}
			if c.method != "OPTIONS" {
				return
			}
			if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") || !strings.Contains(got, "DELETE") {
				t.Fatalf("Access-Control-Allow-Methods %q", got)
			}
			if got := strings.ToLower(resp.Header.Get("Access-Control-Allow-Headers")); !strings.Contains(got, "authorization") || !strings.Contains(got, "content-type") {
				t.Fatalf("Access-Control-Allow-Headers %q", got)
			}
		})
	}
}

func TestServeWithoutAllowedOriginsKeepsTheHTTPAPIAsItWas(t *testing.T) {
	f := newFakeDaemon()
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	resp := request(t, ts.URL, "GET", "/api/v1/hello", "https://evil.example")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin %q, want none", got)
	}
}

func TestServeStreamAcceptsAnAllowedOrigin(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL, AllowedOrigins: []string{pairedOrigin}})
	for _, origin := range []string{pairedOrigin, publicURL} {
		c, _, err := dialStream(t, ts, origin)
		if err != nil {
			t.Fatalf("origin %q refused: %v", origin, err)
		}
		_ = c.CloseNow()
	}
	_, resp, err := dialStream(t, ts, "https://evil.example")
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("unlisted origin: %v %v", resp, err)
	}
}

func TestServeStreamAcceptsAnAllowedOriginWithoutAPublicURL(t *testing.T) {
	f := newFakeDaemon()
	_, ts := startServer(t, f, serve.Config{AllowedOrigins: []string{pairedOrigin}})
	c, _, err := dialStream(t, ts, pairedOrigin)
	if err != nil {
		t.Fatalf("refused: %v", err)
	}
	_ = c.CloseNow()
}

func TestServeRefusesAWildcardOrABadAllowedOrigin(t *testing.T) {
	for _, origins := range [][]string{{"*"}, {pairedOrigin, "*"}, {"https://*.example.ts.net"}, {"ftp://other-mac"}, {"https://other-mac.example.ts.net/app"}, {""}} {
		_, err := serve.New(serve.Config{URL: publicURL, AllowedOrigins: origins, Dial: newFakeDaemon().dial})
		if err == nil {
			t.Fatalf("%q: no error", origins)
		}
		if !strings.Contains(err.Error(), "allowed_origins") {
			t.Fatalf("%q: error %q does not name allowed_origins", origins, err)
		}
	}
	_, err := serve.New(serve.Config{URL: publicURL, AllowedOrigins: []string{"*"}, Dial: newFakeDaemon().dial})
	if !strings.Contains(err.Error(), "exact origins") {
		t.Fatalf("error %q does not tell to list exact origins", err)
	}
}
