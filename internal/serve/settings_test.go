package serve_test

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

var settingsEndpoints = []authedEndpoint{
	{"GET", "/api/v1/config", ""},
	{"POST", "/api/v1/config", `{"key":"fallback.threshold","value":"80"}`},
	{"GET", "/api/v1/onboarding", ""},
	{"POST", "/api/v1/onboarding/install", `{"harness":"claude"}`},
	{"POST", "/api/v1/onboarding/remove", `{"harness":"claude"}`},
	{"POST", "/api/v1/onboarding/nvim", ""},
	{"POST", "/api/v1/onboarding/finish", ""},
	{"GET", "/api/v1/workspaces/dirs?path=/home/me", ""},
	{"GET", "/api/v1/devices", ""},
	{"POST", "/api/v1/devices/t4bl3t00/revoke", ""},
	{"POST", "/api/v1/pair/code", `{"name":"tablet"}`},
}

func TestServeSettingsRoutesCallTheirDaemonMethods(t *testing.T) {
	expires := time.Date(2026, 10, 3, 12, 5, 0, 0, time.UTC)
	cases := []struct {
		ep     authedEndpoint
		method string
		params string
		result any
		golden string
	}{
		{settingsEndpoints[0], rpc.MethodConfigGet, `{}`,
			rpc.ConfigValues{Path: "/home/me/.crew/config.toml", Values: map[string]string{"fallback.threshold": "80", "push.away_after": "2m"}}, "config.json"},
		{settingsEndpoints[1], rpc.MethodConfigSet, `{"key":"fallback.threshold","value":"80"}`,
			rpc.ConfigValues{Path: "/home/me/.crew/config.toml", Values: map[string]string{"fallback.threshold": "80", "push.away_after": "2m"}}, "config.json"},
		{settingsEndpoints[2], rpc.MethodOnboarding, `{}`,
			domain.Onboarding{Done: true, Harnesses: map[domain.Harness]domain.HarnessSetup{"claude": {Installed: true, File: "/home/me/.claude/settings.json"}, "codex": {File: "/home/me/.codex/hooks.json"}},
				Nvim: domain.NvimSetup{OnPath: true, ConfigFile: "/home/me/.config/nvim/init.lua", PluginDir: "/home/me/.crew/nvim", PluginFound: true}}, "onboarding.json"},
		{settingsEndpoints[3], rpc.MethodOnboardingInstall, `{"harness":"claude"}`,
			domain.HarnessSetup{Installed: true, File: "/home/me/.claude/settings.json", Backup: "/home/me/.claude/settings.json.bak"}, "onboarding-hooks.json"},
		{settingsEndpoints[4], rpc.MethodOnboardingRemove, `{"harness":"claude"}`,
			domain.HarnessSetup{Installed: true, File: "/home/me/.claude/settings.json", Backup: "/home/me/.claude/settings.json.bak"}, "onboarding-hooks.json"},
		{settingsEndpoints[5], rpc.MethodOnboardingNvim, `{}`,
			domain.NvimSetup{OnPath: true, Configured: true, ConfigFile: "/home/me/.config/nvim/init.lua", PluginDir: "/home/me/.crew/nvim", PluginFound: true}, "onboarding-nvim.json"},
		{settingsEndpoints[6], rpc.MethodOnboardingFinish, `{}`, nil, ""},
		{settingsEndpoints[7], rpc.MethodWorkspaceDirs, `{"path":"/home/me"}`,
			rpc.WorkspaceDirs{Dirs: []domain.Child{{Name: "api", Path: "/home/me/api", Git: domain.GitDir}, {Name: "notes", Path: "/home/me/notes"}}}, "workspace-dirs.json"},
		{settingsEndpoints[8], rpc.MethodDeviceList, `{}`, rpc.DeviceList{Devices: []rpc.Device{phone, tablet}}, "devices.json"},
		{settingsEndpoints[9], rpc.MethodDeviceRevoke, `{"id":"t4bl3t00"}`, nil, ""},
		{settingsEndpoints[10], rpc.MethodPairCode, `{"name":"tablet"}`, rpc.PairCode{Code: "482913", ExpiresAt: expires}, "pair-code.json"},
	}
	for _, c := range cases {
		t.Run(c.ep.method+" "+c.ep.path, func(t *testing.T) {
			f := newFakeDaemon()
			f.devices[goodToken] = phone
			if c.result != nil {
				f.results[c.method] = c.result
			}
			_, ts := startServer(t, f, serve.Config{URL: publicURL})
			status, out := do(t, ts, c.ep.method, c.ep.path, goodToken, c.ep.body)
			if status != http.StatusOK {
				t.Fatalf("status %d %s", status, out)
			}
			if params := f.paramsOf(c.method); len(params) != 1 || string(params[0]) != c.params {
				t.Fatalf("%s params %s, want %s", c.method, params, c.params)
			}
			if c.golden != "" {
				golden(t, c.golden, out)
			} else if string(out) != "{}\n" {
				t.Fatalf("body %s, want {}", out)
			}
		})
	}
}

func TestServeSettingsRoutesAreOnlyForTheOwnerDevice(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, ep := range settingsEndpoints {
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

func TestServeSettingsBodiesAreChecked(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	for _, c := range []struct{ path, body string }{
		{"/api/v1/config", `{"key":"","value":"1"}`},
		{"/api/v1/config", `{"key":"theme.blue","value":"#000000","extra":1}`},
		{"/api/v1/onboarding/install", `{"harness":""}`},
		{"/api/v1/onboarding/remove", `{}`},
	} {
		if status, out := do(t, ts, "POST", c.path, goodToken, c.body); status != http.StatusBadRequest {
			t.Fatalf("%s %s: status %d %s", c.path, c.body, status, out)
		}
	}
	if status, out := do(t, ts, "GET", "/api/v1/workspaces/dirs", goodToken, ""); status != http.StatusBadRequest {
		t.Fatalf("dirs with no path: status %d %s", status, out)
	}
	if slices.ContainsFunc(f.methods(), func(m string) bool { return m != rpc.MethodDeviceCheck && m != rpc.MethodSubscribe }) {
		t.Fatalf("a refused body reached the daemon: %v", f.methods())
	}
}
