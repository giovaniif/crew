//go:build integration

package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
)

type hookLog struct {
	mu    sync.Mutex
	lines []string
}

func (h *hookLog) has(s string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, l := range h.lines {
		if strings.Contains(l, s) {
			return true
		}
	}
	return false
}

func listenHooks(t *testing.T, sock string) *hookLog {
	t.Helper()
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	log := &hookLog{}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = c.Close() }()
				line, _ := bufio.NewReader(c).ReadString('\n')
				log.mu.Lock()
				log.lines = append(log.lines, line)
				log.mu.Unlock()
			}()
		}
	}()
	return log
}

func TestEnvSeedIntegrationFreshEnvReachesThePromptAndFiresACrewHook(t *testing.T) {
	for _, bin := range []string{"tmux", "go", "claude", "codex"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skip(bin + " not installed")
		}
	}
	base, err := os.MkdirTemp("/tmp", "crew-seed-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(base) })
	base, _ = filepath.EvalSymlinks(base)
	home := filepath.Join(base, "h")
	fakeHome := filepath.Join(base, "home")
	work := filepath.Join(base, "work")
	for _, d := range []string{home, fakeHome, work} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	_, file, _, _ := runtime.Caller(0)
	crewBin := filepath.Join(base, "crew")
	build := exec.Command("go", "build", "-o", crewBin, ".")
	build.Dir = filepath.Dir(file)
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build crew: %v\n%s", err, out)
	}
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvClaude, domain.EnvCodex}}); err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{"ANTHROPIC_API_KEY": "TEST-not-real-anthropic-0123456789", "OPENAI_API_KEY": "TEST-not-real-openai"} {
		if err := s.SetSecret("test-bot", k, v); err != nil {
			t.Fatal(err)
		}
	}
	hooks := listenHooks(t, filepath.Join(home, "crew.sock"))
	socket := fmt.Sprintf("crew-seed-%d", os.Getpid())
	tm := func(args ...string) string {
		out, _ := exec.Command("tmux", append([]string{"-L", socket, "-f", "/dev/null"}, args...)...).CombinedOutput()
		return string(out)
	}
	t.Cleanup(func() { tm("kill-server") })
	envArgs := []string{"env", "-i", "HOME=" + fakeHome, "PATH=" + os.Getenv("PATH"), "TERM=xterm-256color", "CREW_HOME=" + home, "LANG=C.UTF-8"}
	wait := func(target, name string, ok func(string) bool) string {
		t.Helper()
		var screen string
		for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(500 * time.Millisecond) {
			screen = tm("capture-pane", "-p", "-t", target)
			if ok(screen) {
				return screen
			}
		}
		t.Fatalf("%s: timed out; screen:\n%s", name, screen)
		return screen
	}
	dialogs := []string{"Choose the text style", "Quick safety check", "Do you want to use this API key", "Sign in with ChatGPT", "Provide your own API key", "Hooks need review", "Do you trust", "Require approval"}
	noDialog := func(name, screen string) {
		t.Helper()
		for _, d := range dialogs {
			if strings.Contains(screen, d) {
				t.Fatalf("%s shows the first-run dialog %q:\n%s", name, d, screen)
			}
		}
	}

	claudeCmd := append(append([]string{}, envArgs...), crewBin, "env", "exec", "test-bot", "--harness", "claude", "--", "claude")
	tm(append([]string{"new-session", "-d", "-s", "c", "-x", "200", "-y", "50", "-c", work}, claudeCmd...)...)
	screen := wait("c", "claude", func(s string) bool {
		for _, d := range dialogs {
			if strings.Contains(s, d) {
				return true
			}
		}
		return strings.Contains(s, "❯") && strings.Contains(s, "Claude Code v")
	})
	noDialog("claude", screen)
	for deadline := time.Now().Add(20 * time.Second); !hooks.has(`"harness":"claude"`) && time.Now().Before(deadline); {
		time.Sleep(200 * time.Millisecond)
	}
	if !hooks.has(`"harness":"claude"`) {
		t.Errorf("no crew hook from claude; screen:\n%s", screen)
	}

	codexCmd := append(append([]string{}, envArgs...), crewBin, "env", "exec", "test-bot", "--harness", "codex", "--", "codex")
	codexCmd = append(codexCmd, domain.CodexEnvHookTrustArgs()...)
	tm(append([]string{"new-session", "-d", "-s", "x", "-x", "200", "-y", "50", "-c", work}, codexCmd...)...)
	screen = wait("x", "codex", func(s string) bool {
		for _, d := range dialogs {
			if strings.Contains(s, d) {
				return true
			}
		}
		return strings.Contains(s, "OpenAI Codex") && strings.Contains(s, "›")
	})
	noDialog("codex", screen)
	tm("send-keys", "-t", "x", "-l", "hello")
	time.Sleep(500 * time.Millisecond)
	tm("send-keys", "-t", "x", "Enter")
	for deadline := time.Now().Add(45 * time.Second); !hooks.has(`"harness":"codex"`) && time.Now().Before(deadline); {
		time.Sleep(300 * time.Millisecond)
	}
	if !hooks.has(`"harness":"codex"`) {
		t.Errorf("no crew hook from codex; screen:\n%s", tm("capture-pane", "-p", "-t", "x"))
	}
	if entries, _ := os.ReadDir(fakeHome); len(entries) != 0 {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Logf("files in the fake HOME: %v", names)
	}
}
