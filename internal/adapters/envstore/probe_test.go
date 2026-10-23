package envstore_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/app"
)

const probeSecret = "TEST-zzprobesecretzz"

type probeRun struct {
	answers map[string]probeAnswer
	seen    []string
}

type probeAnswer struct {
	out  string
	code int
}

func (r *probeRun) run(name string, args ...string) ([]byte, int, error) {
	key := strings.Join(append([]string{name}, args...), " ")
	r.seen = append(r.seen, key)
	a, ok := r.answers[key]
	if !ok {
		return nil, 1, nil
	}
	return []byte(a.out), a.code, nil
}

func probeHome(t *testing.T, files ...string) string {
	t.Helper()
	home := t.TempDir()
	for _, f := range files {
		p := filepath.Join(home, f)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(probeSecret), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func envOf(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestProbeReportsWhatThisMachineHasWithoutItsSecrets(t *testing.T) {
	home := probeHome(t, ".claude/.credentials.json", ".omp/agent/auth.json")
	run := &probeRun{answers: map[string]probeAnswer{
		"git config --global user.name":                 {out: "TEST Owner\n"},
		"git config --global user.email":                {out: "owner@example.com\n"},
		"ssh-add -l":                                    {out: "256 SHA256:aaa one (ED25519)\n256 SHA256:bbb two (ED25519)\n"},
		"gh auth status --active --hostname github.com": {out: "github.com\n  ✓ Logged in to github.com account owner (keyring)\n  - Token: gho_************\n"},
	}}
	p := envstore.Probe{Home: home, Env: envOf(map[string]string{"SSH_AUTH_SOCK": "/tmp/TEST-agent.sock"}), Run: run.run}
	got := p.Local()
	want := app.LocalFacts{GitName: "TEST Owner", GitEmail: "owner@example.com", SSHAgent: true, SSHKeys: 2, GitHub: true, GitHubUser: "owner", Claude: true, Codex: false, Pi: true}
	if got != want {
		t.Errorf("facts %+v, want %+v", got, want)
	}
	b, _ := json.Marshal(got)
	if strings.Contains(string(b), probeSecret) || strings.Contains(string(b), "gho_") {
		t.Errorf("facts hold a secret: %s", b)
	}
}

func TestProbeSeesNoAgentAndNoLogins(t *testing.T) {
	home := probeHome(t)
	run := &probeRun{answers: map[string]probeAnswer{
		"gh auth status --active --hostname github.com": {out: "You are not logged into any GitHub hosts.\n", code: 1},
	}}
	got := envstore.Probe{Home: home, Env: envOf(nil), Run: run.run}.Local()
	if got != (app.LocalFacts{}) {
		t.Errorf("facts %+v, want none", got)
	}
	for _, s := range run.seen {
		if strings.HasPrefix(s, "ssh-add") {
			t.Errorf("ran %q with no SSH_AUTH_SOCK", s)
		}
	}
}

func TestProbeUsesTheHarnessDirsAndKeysOfTheDaemonEnvironment(t *testing.T) {
	home := probeHome(t, "cc/.credentials.json", "cx/auth.json")
	vars := map[string]string{
		"CLAUDE_CONFIG_DIR": filepath.Join(home, "cc"),
		"CODEX_HOME":        filepath.Join(home, "cx"),
		"OPENAI_API_KEY":    probeSecret,
		"GH_TOKEN":          probeSecret,
		"SSH_AUTH_SOCK":     "/tmp/TEST-agent.sock",
	}
	run := &probeRun{answers: map[string]probeAnswer{"ssh-add -l": {out: "The agent has no identities.\n", code: 1}}}
	got := envstore.Probe{Home: home, Env: envOf(vars), Run: run.run}.Local()
	want := app.LocalFacts{SSHAgent: true, GitHub: true, Claude: true, Codex: true, Pi: true}
	if got != want {
		t.Errorf("facts %+v, want %+v", got, want)
	}
}
