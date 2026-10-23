package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
)

func TestEnvLoginWithACodexHarnessRunsTheCodexDeviceLogin(t *testing.T) {
	want := []string{"exec", "bot", "--harness", "codex", "--", "codex", "login", "--device-auth"}
	if got := envLoginArgvFor("bot", domain.HarnessCodex); !reflect.DeepEqual(got, want) {
		t.Errorf("argv %v", got)
	}
	if got := envLoginArgvFor("bot", domain.HarnessClaude); !reflect.DeepEqual(got, envLoginArgv("bot")) {
		t.Errorf("claude argv %v", got)
	}
}

func TestEnvLoginRejectsAnUnknownHarness(t *testing.T) {
	for _, args := range [][]string{{"login", "bot", "--harness"}, {"login", "bot", "--harness", "bogus"}, {"login", "bot", "--harness", "omp"}, {"login", "bot", "codex"}} {
		var out, errOut bytes.Buffer
		if code := runEnv(args, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "usage: crew env") {
			t.Errorf("%v: code %d, stderr %q", args, code, errOut.String())
		}
	}
}

func TestEnvLoginCodexWritesAuthOnlyIntoTheCodexHomeOfTheEnvironment(t *testing.T) {
	home := t.TempDir()
	s := envstore.Store{Home: home}
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvCodex}}); err != nil {
		t.Fatal(err)
	}
	userHome := t.TempDir()
	personal := filepath.Join(userHome, ".codex")
	if err := os.MkdirAll(personal, 0o700); err != nil {
		t.Fatal(err)
	}
	personalFiles := map[string]string{"auth.json": `{"auth_mode":"chatgpt","tokens":{"access_token":"TEST-personal"}}`, "config.toml": "model = \"gpt-test\"\n"}
	for name, body := range personalFiles {
		if err := os.WriteFile(filepath.Join(personal, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	bin := t.TempDir()
	stub := "#!/bin/sh\necho \"$@\" > \"${CODEX_HOME:-$HOME/.codex}/login-args\"\nprintf '{\"auth_mode\":\"chatgpt\",\"tokens\":{\"access_token\":\"TEST-env\"}}' > \"${CODEX_HOME:-$HOME/.codex}/auth.json\"\n"
	if err := os.WriteFile(filepath.Join(bin, "codex"), []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=TestEnvExecHelperProcess", "--", "env", "login", "test-bot", "--harness", "codex")
	cmd.Env = []string{"CREW_TEST_ENV_EXEC=1", "CREW_HOME=" + home, "HOME=" + userHome, "PATH=" + bin + ":/usr/bin:/bin"}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("%v: %s", err, stderr.String())
	}
	envCodex := filepath.Join(home, "envs", "test-bot", "codex")
	if b, err := os.ReadFile(filepath.Join(envCodex, "auth.json")); err != nil || !strings.Contains(string(b), "TEST-env") {
		t.Errorf("env auth.json %q, %v", b, err)
	}
	if b, _ := os.ReadFile(filepath.Join(envCodex, "login-args")); strings.TrimSpace(string(b)) != "login --device-auth" {
		t.Errorf("codex args %q", b)
	}
	entries, _ := os.ReadDir(personal)
	if len(entries) != len(personalFiles) {
		t.Errorf("personal ~/.codex has %d entries, want %d", len(entries), len(personalFiles))
	}
	for name, body := range personalFiles {
		if b, err := os.ReadFile(filepath.Join(personal, name)); err != nil || string(b) != body {
			t.Errorf("personal %s changed: %q, %v", name, b, err)
		}
	}
	if !s.CodexLogin("test-bot") {
		t.Error("the environment does not record the codex login")
	}
}
