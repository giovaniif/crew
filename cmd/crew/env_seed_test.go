package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
)

func snapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			b, _ := os.ReadFile(p)
			out[p] = string(b)
		}
		return nil
	})
	return out
}

func TestSeedEnvInstallsHooksAndSeedsEachHarnessDir(t *testing.T) {
	home := t.TempDir()
	fakeHome := t.TempDir()
	t.Setenv("HOME", fakeHome)
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	t.Setenv("CODEX_HOME", "")
	t.Setenv("PI_CODING_AGENT_DIR", "")
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvClaude, domain.EnvCodex, domain.EnvPi}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSecret("test-bot", "ANTHROPIC_API_KEY", "TEST-not-real-0123456789abcdefghij"); err != nil {
		t.Fatal(err)
	}
	environ, err := envFor(s, "test-bot", os.Environ())
	if err != nil {
		t.Fatal(err)
	}
	work := t.TempDir()
	if err := seedEnv(s, "test-bot", environ, work, "/opt/crew"); err != nil {
		t.Fatal(err)
	}
	envDir := filepath.Join(home, "identities", "test-bot")
	for file, want := range map[string]string{
		"claude/settings.json":   "hook --harness claude",
		"claude/.claude.json":    work,
		"codex/hooks.json":       "hook --harness codex",
		"codex/config.toml":      "OPENAI_API_KEY",
		"omp/hooks/post/crew.ts": "/opt/crew",
		"omp/config.yml":         "setupWizard: false",
	} {
		b, err := os.ReadFile(filepath.Join(envDir, file))
		if err != nil || !strings.Contains(string(b), want) {
			t.Errorf("%s: %v, no %q in %q", file, err, want, b)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(envDir, "claude", ".claude.json")); !strings.Contains(string(b), "0123456789abcdefghij") {
		t.Errorf("the API key is not approved: %s", b)
	}
	if got := snapshot(t, fakeHome); len(got) != 0 {
		t.Errorf("the real home changed: %v", got)
	}
	before := snapshot(t, envDir)
	if err := seedEnv(s, "test-bot", environ, work, "/opt/crew"); err != nil {
		t.Fatal(err)
	}
	after := snapshot(t, envDir)
	if len(before) != len(after) {
		t.Errorf("a second run added files: %d to %d", len(before), len(after))
	}
	for p, b := range before {
		if after[p] != b {
			t.Errorf("a second run changed %s", p)
		}
	}
}

func TestSeedEnvLeavesTheLocalEnvironmentAlone(t *testing.T) {
	home := t.TempDir()
	dir := t.TempDir()
	environ := []string{"CLAUDE_CONFIG_DIR=" + dir, "CODEX_HOME=" + dir, "PI_CODING_AGENT_DIR=" + dir}
	if err := seedEnv(envstore.Store{Home: home}, "", environ, t.TempDir(), "/opt/crew"); err != nil {
		t.Fatal(err)
	}
	if got := snapshot(t, dir); len(got) != 0 {
		t.Errorf("local seeded the user's dirs: %v", got)
	}
}
