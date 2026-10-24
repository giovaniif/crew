//go:build integration

package daemon_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/adapters/tmux"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestMateEnvIntegrationAppliesTheEnvInThePaneAndKeepsSecretsOutOfPs(t *testing.T) {
	for _, bin := range []string{"git", "tmux", "go", "ps"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skip(bin + " not installed")
		}
	}
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_SYSTEM", "/dev/null")
	for _, kv := range [][2]string{{"GIT_AUTHOR_NAME", "t"}, {"GIT_AUTHOR_EMAIL", "t@example.com"}, {"GIT_COMMITTER_NAME", "t"}, {"GIT_COMMITTER_EMAIL", "t@example.com"}} {
		t.Setenv(kv[0], kv[1])
	}
	home, err := filepath.EvalSymlinks(shortDir(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CREW_HOME", home)
	t.Setenv("SSH_AUTH_SOCK", "/run/test-agent")
	_, file, _, _ := runtime.Caller(0)
	crewBin := filepath.Join(home, "crew")
	build := exec.Command("go", "build", "-o", crewBin, "./cmd/crew")
	build.Dir = filepath.Join(filepath.Dir(file), "..", "..")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build crew: %v\n%s", err, out)
	}
	scratch := filepath.Join(home, "src")
	if err := os.MkdirAll(scratch, 0o755); err != nil {
		t.Fatal(err)
	}
	api := filepath.Join(scratch, "api")
	cloneRepo(t, scratch, api)
	config := filepath.Join(home, "config.toml")
	body := fmt.Sprintf("[[mate]]\nname = \"helper\"\nprompt = \"You help.\"\nagent = \"claude\"\nrepos = [%q]\nenv = \"test-bot\"\n", api)
	if err := os.WriteFile(config, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	store := envstore.Store{Home: home}
	if err := store.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub, domain.EnvClaude}}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSecret("test-bot", "CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-TEST"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSecret("test-bot", "GH_TOKEN", "TEST-gh-token"); err != nil {
		t.Fatal(err)
	}
	dump := filepath.Join(home, "env.out")
	fakeAgent := filepath.Join(home, "fake-agent")
	script := fmt.Sprintf("#!/bin/sh\nenv > %q.tmp && mv %q.tmp %q\nexec cat\n", dump, dump, dump)
	if err := os.WriteFile(fakeAgent, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	socket := fmt.Sprintf("crew-mateenv-%d-%d", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() {
		_ = tmux.New(tmux.Config{Socket: socket, ConfigPath: filepath.Join(home, "tmux.conf")}).Close(context.Background())
	})
	live := serveLive(t, home, socket, fakeAgent, daemon.WithConfig(config), daemon.WithFirstPromptGrace(time.Hour), daemon.WithEnvLauncher(crewBin))
	ctx := context.Background()
	if err := live.c.Call(ctx, rpc.MethodWorkspaceAdd, rpc.WorkspaceAddParams{Path: api}, nil); err != nil {
		t.Fatal(err)
	}
	if err := live.c.Call(ctx, rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "TEST prompt"}, nil); err != nil {
		t.Fatal(err)
	}
	var env string
	waitFor(t, func() bool {
		b, err := os.ReadFile(dump)
		env = string(b)
		return err == nil && env != ""
	})
	for _, want := range []string{"CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-TEST", "GH_TOKEN=TEST-gh-token", "CLAUDE_CONFIG_DIR=" + filepath.Join(home, "identities", "test-bot", "claude")} {
		if !strings.Contains(env, want+"\n") {
			t.Errorf("pane env has no %s:\n%s", want, env)
		}
	}
	if strings.Contains(env, "SSH_AUTH_SOCK=") {
		t.Errorf("SSH_AUTH_SOCK reached the pane:\n%s", env)
	}
	ps, err := exec.Command("ps", "-eo", "args").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ps), "TEST-gh-token") || strings.Contains(string(ps), "sk-ant-oat01-TEST") {
		t.Errorf("ps shows a secret")
	}
}
