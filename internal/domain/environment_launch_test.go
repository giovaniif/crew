package domain

import (
	"slices"
	"testing"
)

func TestEnvLaunchCommand(t *testing.T) {
	cases := []struct {
		name    string
		env     string
		harness Harness
		in      []string
		want    []string
	}{
		{"no env keeps the command", "", HarnessClaude, []string{"claude", "--model", "opus"}, []string{"claude", "--model", "opus"}},
		{"claude start", "test-bot", HarnessClaude, []string{"claude", "--", "hi"},
			[]string{"/bin/crew", "env", "exec", "test-bot", "--harness", "claude", "--", "claude", "--", "hi"}},
		{"claude resume", "test-bot", HarnessClaude, []string{"claude", "--resume", "abc"},
			[]string{"/bin/crew", "env", "exec", "test-bot", "--harness", "claude", "--", "claude", "--resume", "abc"}},
		{"local with a name is wrapped", "local", HarnessOmp, []string{"omp", "--", "hi"},
			[]string{"/bin/crew", "env", "exec", "local", "--harness", "omp", "--", "omp", "--", "hi"}},
		{"codex start", "test-bot", HarnessCodex, []string{"codex", "--model", "m", "--", "hi"},
			[]string{"/bin/crew", "env", "exec", "test-bot", "--harness", "codex", "--", "codex", "--dangerously-bypass-hook-trust", "--model", "m", "--", "hi"}},
		{"codex resume", "test-bot", HarnessCodex, []string{"codex", "resume", "--model", "m", "abc"},
			[]string{"/bin/crew", "env", "exec", "test-bot", "--harness", "codex", "--", "codex", "resume", "--dangerously-bypass-hook-trust", "--model", "m", "abc"}},
		{"empty command", "test-bot", HarnessClaude, nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := slices.Clone(tc.in)
			got := EnvLaunchCommand("/bin/crew", tc.env, tc.harness, in)
			if !slices.Equal(got, tc.want) {
				t.Errorf("got %q, want %q", got, tc.want)
			}
			if !slices.Equal(in, tc.in) {
				t.Errorf("input changed: %q", in)
			}
		})
	}
}

func TestCodexEnvHookTrustArgs(t *testing.T) {
	if got := CodexEnvHookTrustArgs(); !slices.Equal(got, []string{"--dangerously-bypass-hook-trust"}) {
		t.Errorf("got %q", got)
	}
}
