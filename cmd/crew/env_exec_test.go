package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
)

func TestEnvExecHelperProcess(t *testing.T) {
	if os.Getenv("CREW_TEST_ENV_EXEC") != "1" {
		t.Skip("helper process")
	}
	args := os.Args[slices.Index(os.Args, "--")+1:]
	os.Exit(run(args, os.Stdout, os.Stderr))
}

func runEnvExec(t *testing.T, home string, extra []string, args ...string) (map[string]string, string, error) {
	t.Helper()
	dump := filepath.Join(t.TempDir(), "env.out")
	argv := append([]string{"-test.run=TestEnvExecHelperProcess", "--", "env", "exec"}, args...)
	argv = append(argv, "--", "/bin/sh", "-c", "env > "+dump)
	cmd := exec.Command(os.Args[0], argv...)
	cmd.Env = append([]string{"CREW_TEST_ENV_EXEC=1", "CREW_HOME=" + home, "PATH=/usr/bin:/bin", "HOME=/home/test",
		"SSH_AUTH_SOCK=/run/agent", "GH_TOKEN=personal", "EDITOR=vim"}, extra...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	got := map[string]string{}
	if b, readErr := os.ReadFile(dump); readErr == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			k, v, _ := strings.Cut(line, "=")
			got[k] = v
		}
	}
	return got, stderr.String(), err
}

func TestEnvExecAppliesACustomEnvironment(t *testing.T) {
	home := t.TempDir()
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub, domain.EnvClaude}}); err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{"GH_TOKEN": "TEST-gh", "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-TEST", "LINEAR_API_KEY": "TEST-lin"} {
		if err := s.SetSecret("test-bot", k, v); err != nil {
			t.Fatal(err)
		}
	}
	got, stderr, err := runEnvExec(t, home, nil, "test-bot")
	if err != nil {
		t.Fatalf("%v: %s", err, stderr)
	}
	want := map[string]string{
		"GH_TOKEN": "TEST-gh", "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-TEST", "LINEAR_API_KEY": "TEST-lin",
		"CLAUDE_CONFIG_DIR": filepath.Join(home, "envs", "test-bot", "claude"), "GH_CONFIG_DIR": filepath.Join(home, "envs", "test-bot", "gh"),
		"CREW_HOME": home,
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s=%q, want %q", k, got[k], v)
		}
	}
	for _, k := range []string{"SSH_AUTH_SOCK", "EDITOR", "CREW_TEST_ENV_EXEC"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s not dropped", k)
		}
	}
}

func TestEnvExecLocalKeepsTheEnviron(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"", "local"} {
		args := []string{name}
		if name == "" {
			args = nil
		}
		got, stderr, err := runEnvExec(t, home, nil, args...)
		if err != nil {
			t.Fatalf("%q: %v: %s", name, err, stderr)
		}
		if got["SSH_AUTH_SOCK"] != "/run/agent" || got["GH_TOKEN"] != "personal" || got["EDITOR"] != "vim" {
			t.Errorf("%q: local changed the environ: %v", name, got)
		}
	}
}

func TestEnvExecUnknownEnvFails(t *testing.T) {
	home := t.TempDir()
	_, stderr, err := runEnvExec(t, home, nil, "nope")
	if err == nil {
		t.Fatal("unknown env ran")
	}
	if !strings.Contains(stderr, `"nope"`) {
		t.Errorf("stderr %q does not name the env", stderr)
	}
}

func TestEnvExecUsage(t *testing.T) {
	var stderr bytes.Buffer
	for _, args := range [][]string{{"env"}, {"env", "exec"}, {"env", "exec", "test-bot"}, {"env", "exec", "test-bot", "--"}, {"env", "bogus"}, {"env", "exec", "test-bot", "--harness", "--", "sh"}, {"env", "exec", "test-bot", "--harness", "bogus", "--", "sh"}} {
		stderr.Reset()
		if code := run(args, &bytes.Buffer{}, &stderr); code != 2 {
			t.Errorf("%v: exit %d", args, code)
		}
		if !strings.Contains(stderr.String(), "usage: crew env") {
			t.Errorf("%v: %q", args, stderr.String())
		}
	}
}

func TestEnvExecMissingProgramNamesItAndNoValue(t *testing.T) {
	home := t.TempDir()
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSecret("test-bot", "GH_TOKEN", "TEST-gh"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CREW_HOME", home)
	var stderr bytes.Buffer
	code := run([]string{"env", "exec", "test-bot", "--", "crew-no-such-program"}, &bytes.Buffer{}, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "crew-no-such-program") || strings.Contains(stderr.String(), "TEST-") {
		t.Errorf("exit %d, stderr %q", code, stderr.String())
	}
}

func TestEnvExecWithAHarnessGivesOnlyItsAccountAndSeedsOnlyItsDir(t *testing.T) {
	home := t.TempDir()
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub, domain.EnvClaude, domain.EnvCodex}}); err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{"GH_TOKEN": "TEST-gh", "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-TEST", "OPENAI_API_KEY": "TEST-oai"} {
		if err := s.SetSecret("test-bot", k, v); err != nil {
			t.Fatal(err)
		}
	}
	got, stderr, err := runEnvExec(t, home, nil, "test-bot", "--harness", "codex")
	if err != nil {
		t.Fatalf("%v: %s", err, stderr)
	}
	if got["GH_TOKEN"] != "TEST-gh" || got["OPENAI_API_KEY"] != "TEST-oai" || got["CODEX_HOME"] != filepath.Join(home, "envs", "test-bot", "codex") {
		t.Errorf("codex account missing: %v", got)
	}
	for _, k := range []string{"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s given to a codex mate", k)
		}
	}
	if _, err := os.Stat(filepath.Join(home, "envs", "test-bot", "claude", "settings.json")); err == nil {
		t.Error("the claude dir was seeded for a codex mate")
	}
}

func TestEnvLoginOmpWritesOnlyIntoTheEnvDir(t *testing.T) {
	home := t.TempDir()
	personal := t.TempDir()
	bin := t.TempDir()
	if err := os.MkdirAll(filepath.Join(personal, ".omp", "agent"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(personal, ".omp", "agent", "agent.db"), []byte("TEST-personal"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := "#!/bin/sh\nprintf '%s' \"$*\" > \"$PI_CODING_AGENT_DIR/agent.db\"\n"
	if err := os.WriteFile(filepath.Join(bin, "omp"), []byte(fake), 0o755); err != nil {
		t.Fatal(err)
	}
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvPi}}); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=TestEnvExecHelperProcess", "--", "env", "login", "test-bot", "--harness", "omp")
	cmd.Env = []string{"CREW_TEST_ENV_EXEC=1", "CREW_HOME=" + home, "PATH=" + bin + ":/usr/bin:/bin", "HOME=" + personal}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("%v: %s", err, stderr.String())
	}
	got, err := os.ReadFile(filepath.Join(home, "envs", "test-bot", "omp", "agent.db"))
	if err != nil || string(got) != "login" {
		t.Errorf("env agent.db %q, %v", got, err)
	}
	mine, _ := os.ReadFile(filepath.Join(personal, ".omp", "agent", "agent.db"))
	if string(mine) != "TEST-personal" {
		t.Errorf("personal agent.db changed: %q", mine)
	}
	if !strings.Contains(stderr.String(), "omp login") {
		t.Errorf("stderr %q", stderr.String())
	}
}
