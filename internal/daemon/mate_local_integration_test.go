//go:build integration

package daemon_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/tmux"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestMateNewIntegrationGivesTheSessionTheMatePromptMemoryAndName(t *testing.T) {
	for _, bin := range []string{"git", "tmux"} {
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
	scratch := filepath.Join(home, "src")
	if err := os.MkdirAll(scratch, 0o755); err != nil {
		t.Fatal(err)
	}
	api := filepath.Join(scratch, "api")
	cloneRepo(t, scratch, api)
	config := filepath.Join(home, "config.toml")
	body := fmt.Sprintf("[[mate]]\nname = \"helper\"\nprompt = \"You are Helper, calm and brief.\"\nagent = \"claude\"\nrepos = [%q]\n", api)
	if err := os.WriteFile(config, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	argv := filepath.Join(home, "argv")
	fakeAgent := filepath.Join(home, "fake-agent")
	script := fmt.Sprintf("#!/bin/sh\nfor a in \"$@\"; do printf '%%s\\n--\\n' \"$a\"; done > %q\nexec cat\n", argv)
	if err := os.WriteFile(fakeAgent, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	socket := fmt.Sprintf("crew-matenew-%d-%d", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() {
		_ = tmux.New(tmux.Config{Socket: socket, ConfigPath: filepath.Join(home, "tmux.conf")}).Close(context.Background())
	})
	live := serveLive(t, home, socket, fakeAgent, daemon.WithConfig(config), daemon.WithFirstPromptGrace(time.Hour))
	ctx := context.Background()
	if err := live.c.Call(ctx, rpc.MethodWorkspaceAdd, rpc.WorkspaceAddParams{Path: api}, nil); err != nil {
		t.Fatal(err)
	}
	if err := live.c.Call(ctx, rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "helper", Text: "- The owner wants small PRs."}, nil); err != nil {
		t.Fatal(err)
	}
	var session domain.Session
	if err := live.c.Call(ctx, rpc.MethodMateNew, rpc.MateNewParams{Name: "helper"}, &session); err != nil {
		t.Fatal(err)
	}
	if session.Mate == nil || session.Mate.Name != "helper" || !session.Mate.Local || !strings.HasPrefix(session.Dir, filepath.Join(home, "worktrees", "api")) {
		t.Fatalf("session %+v", session)
	}
	var args string
	waitFor(t, func() bool {
		b, err := os.ReadFile(argv)
		args = string(b)
		return err == nil && strings.Contains(args, "--append-system-prompt")
	})
	for _, want := range []string{"You are Helper, calm and brief.", "- The owner wants small PRs.", filepath.Join(home, "mates", "helper", "memory.md")} {
		if !strings.Contains(args, want) {
			t.Errorf("argv has no %q:\n%s", want, args)
		}
	}
	waitFor(t, func() bool {
		s, ok := live.sessions(t)[session.ID]
		return ok && s.Mate != nil && s.Mate.Name == "helper"
	})
}
