package domain

import (
	"slices"
	"strings"
	"testing"
)

func customEnv(parts ...EnvPart) Environment {
	return Environment{Name: "test-bot", Kind: EnvCustom, Parts: parts, Home: "/c/envs/test-bot", Secrets: "/c/secrets/env/test-bot"}
}

var boxEnviron = []string{
	"PATH=/usr/bin", "HOME=/home/u", "USER=u", "LOGNAME=u", "SHELL=/bin/bash", "TERM=xterm", "COLORTERM=truecolor",
	"LANG=C.UTF-8", "LC_ALL=C", "LC_TIME=C", "TZ=UTC", "TMPDIR=/tmp", "TMUX=/s,1,0", "TMUX_PANE=%1", "CREW_HOME=/c",
	"XDG_RUNTIME_DIR=/run/u", "DISPLAY=:0", "WAYLAND_DISPLAY=w0",
	"SSH_AUTH_SOCK=/run/agent", "GH_TOKEN=personal", "AWS_SECRET_ACCESS_KEY=x", "CLAUDE_CONFIG_DIR=/home/u/.claude", "EDITOR=vim", "LCX=1",
}

func envMap(env []string) map[string]string {
	m := map[string]string{}
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		if _, dup := m[k]; dup {
			m[k+"#dup"] = v
		}
		m[k] = v
	}
	return m
}

func TestBuildEnvCustomKeepsOnlyTheAllowlist(t *testing.T) {
	got := envMap(BuildEnv(customEnv(), nil, boxEnviron))
	keep := []string{"PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "LC_ALL", "LC_TIME", "TZ", "TMPDIR",
		"TMUX", "TMUX_PANE", "CREW_HOME", "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY"}
	for _, k := range keep {
		if _, ok := got[k]; !ok {
			t.Errorf("%s dropped", k)
		}
	}
	if len(got) != len(keep) {
		t.Errorf("got %d vars, want %d: %v", len(got), len(keep), got)
	}
	for _, k := range []string{"SSH_AUTH_SOCK", "GH_TOKEN", "AWS_SECRET_ACCESS_KEY", "CLAUDE_CONFIG_DIR", "EDITOR", "LCX"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s kept", k)
		}
	}
}

func TestBuildEnvLocal(t *testing.T) {
	local := Environment{Name: "local", Kind: EnvLocal}
	if got := BuildEnv(local, map[string]string{"GH_TOKEN": "TEST-x"}, boxEnviron); !slices.Equal(got, boxEnviron) {
		t.Errorf("local with no extras changed the environ: %v", got)
	}
	local.Extra = []string{"LINEAR_API_KEY", "EDITOR", "PATH", "MISSING"}
	got := envMap(BuildEnv(local, map[string]string{"LINEAR_API_KEY": "TEST-lin", "EDITOR": "nano", "PATH": "/evil"}, boxEnviron))
	if got["LINEAR_API_KEY"] != "TEST-lin" || got["EDITOR"] != "nano" || got["SSH_AUTH_SOCK"] != "/run/agent" {
		t.Errorf("local extras not applied: %v", got)
	}
	if got["PATH"] != "/usr/bin" {
		t.Errorf("denied extra applied: PATH=%s", got["PATH"])
	}
	if _, ok := got["MISSING"]; ok {
		t.Error("extra with no value set")
	}
	if _, dup := got["EDITOR#dup"]; dup {
		t.Error("EDITOR set twice")
	}
}

func TestBuildEnvManagedVarsOnlyForSetParts(t *testing.T) {
	secrets := map[string]string{
		"GH_TOKEN": "TEST-gh", "CLAUDE_CODE_OAUTH_TOKEN": "TEST-oat", "ANTHROPIC_API_KEY": "TEST-ant",
		"OPENAI_API_KEY": "TEST-oai", "GEMINI_API_KEY": "TEST-gem",
	}
	cases := []struct {
		parts []EnvPart
		want  map[string]string
	}{
		{nil, map[string]string{}},
		{[]EnvPart{EnvGit}, map[string]string{"GIT_CONFIG_GLOBAL": "/c/envs/test-bot/gitconfig"}},
		{[]EnvPart{EnvSSH}, map[string]string{"GIT_SSH_COMMAND": "ssh -i '/c/secrets/env/test-bot/ssh/id_ed25519' -o IdentitiesOnly=yes"}},
		{[]EnvPart{EnvGitHub}, map[string]string{"GH_TOKEN": "TEST-gh", "GH_CONFIG_DIR": "/c/envs/test-bot/gh"}},
		{[]EnvPart{EnvClaude}, map[string]string{"CLAUDE_CONFIG_DIR": "/c/envs/test-bot/claude", "CLAUDE_CODE_OAUTH_TOKEN": "TEST-oat", "ANTHROPIC_API_KEY": "TEST-ant"}},
		{[]EnvPart{EnvCodex}, map[string]string{"CODEX_HOME": "/c/envs/test-bot/codex", "OPENAI_API_KEY": "TEST-oai"}},
		{[]EnvPart{EnvPi}, map[string]string{"PI_CODING_AGENT_DIR": "/c/envs/test-bot/omp", "ANTHROPIC_API_KEY": "TEST-ant", "OPENAI_API_KEY": "TEST-oai", "GEMINI_API_KEY": "TEST-gem"}},
	}
	all := []string{"GIT_CONFIG_GLOBAL", "GIT_SSH_COMMAND", "GH_TOKEN", "GH_CONFIG_DIR", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
		"ANTHROPIC_API_KEY", "CODEX_HOME", "OPENAI_API_KEY", "PI_CODING_AGENT_DIR", "GEMINI_API_KEY"}
	for _, tc := range cases {
		got := envMap(BuildEnv(customEnv(tc.parts...), secrets, nil))
		for _, k := range all {
			if got[k] != tc.want[k] {
				t.Errorf("parts %v: %s=%q, want %q", tc.parts, k, got[k], tc.want[k])
			}
		}
	}
}

func TestBuildEnvSkipsManagedSecretsWithNoValue(t *testing.T) {
	got := envMap(BuildEnv(customEnv(EnvGitHub), nil, nil))
	if _, ok := got["GH_TOKEN"]; ok {
		t.Error("GH_TOKEN set with no value")
	}
	if got["GH_CONFIG_DIR"] == "" {
		t.Error("GH_CONFIG_DIR not set")
	}
}

func TestBuildEnvCustomExtras(t *testing.T) {
	env := customEnv(EnvGitHub)
	env.Extra = []string{"LINEAR_API_KEY", "GH_TOKEN", "LD_PRELOAD", "TERM"}
	got := envMap(BuildEnv(env, map[string]string{"LINEAR_API_KEY": "TEST-lin", "GH_TOKEN": "TEST-gh", "LD_PRELOAD": "x.so", "TERM": "dumb"}, boxEnviron))
	if got["LINEAR_API_KEY"] != "TEST-lin" || got["GH_TOKEN"] != "TEST-gh" || got["TERM"] != "dumb" {
		t.Errorf("extras: %v", got)
	}
	if _, ok := got["LD_PRELOAD"]; ok {
		t.Error("denied extra set")
	}
	if _, dup := got["TERM#dup"]; dup {
		t.Error("TERM set twice")
	}
}

func TestValidateExtraVarName(t *testing.T) {
	cases := map[string]bool{
		"LINEAR_API_KEY": true, "_X": true, "lower_ok": true, "A1": true,
		"": false, "1A": false, "A-B": false, "A=B": false, "A B": false,
		"PATH": false, "HOME": false, "TMUX": false, "TMUX_PANE": false, "CREW_HOME": false, "CREW_X": false,
		"AGENTWS_HOME": false, "LD_PRELOAD": false, "DYLD_INSERT_LIBRARIES": false, "path": false, "ld_preload": false,
		"GH_TOKEN": false, "GIT_CONFIG_GLOBAL": false, "GIT_SSH_COMMAND": false, "GH_CONFIG_DIR": false,
		"CLAUDE_CONFIG_DIR": false, "CLAUDE_CODE_OAUTH_TOKEN": false, "ANTHROPIC_API_KEY": false, "CODEX_HOME": false,
		"OPENAI_API_KEY": false, "PI_CODING_AGENT_DIR": false, "GEMINI_API_KEY": false, "OPENROUTER_API_KEY": false,
		"SSH_AUTH_SOCK": false, "PATHX": true, "HOMEBREW": true,
	}
	for name, ok := range cases {
		err := ValidateExtraVarName(name)
		if (err == nil) != ok {
			t.Errorf("%q: err=%v, want ok=%v", name, err, ok)
		}
	}
}

func TestValidateEnvironment(t *testing.T) {
	cases := []struct {
		name    string
		env     Environment
		wantErr string
	}{
		{"custom", customEnv(EnvGit, EnvSSH, EnvGitHub, EnvClaude, EnvCodex, EnvPi), ""},
		{"local", Environment{Name: "local", Kind: EnvLocal, Extra: []string{"LINEAR_API_KEY"}}, ""},
		{"bad name", Environment{Name: "Bot", Kind: EnvCustom}, "name"},
		{"long name", Environment{Name: strings.Repeat("a", 33), Kind: EnvCustom}, "name"},
		{"bad kind", Environment{Name: "x", Kind: "remote"}, "kind"},
		{"local with parts", Environment{Name: "x", Kind: EnvLocal, Parts: []EnvPart{EnvGit}}, "local"},
		{"unknown part", Environment{Name: "x", Kind: EnvCustom, Parts: []EnvPart{"aws"}}, "aws"},
		{"part twice", Environment{Name: "x", Kind: EnvCustom, Parts: []EnvPart{EnvGit, EnvGit}}, "twice"},
		{"denied extra", Environment{Name: "x", Kind: EnvCustom, Extra: []string{"PATH"}}, "PATH"},
		{"extra twice", Environment{Name: "x", Kind: EnvCustom, Extra: []string{"A", "A"}}, "twice"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateEnvironment(tc.env)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("err = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestEnvSecretNames(t *testing.T) {
	env := customEnv(EnvGitHub, EnvCodex)
	env.Extra = []string{"LINEAR_API_KEY"}
	want := []string{"GH_TOKEN", "OPENAI_API_KEY", "LINEAR_API_KEY"}
	if got := EnvSecretNames(env); !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}
