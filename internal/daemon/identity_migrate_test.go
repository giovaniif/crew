package daemon_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/daemon"
)

const oldEnvConfig = `# mine
[[env]]
name = "home"
kind = "local"
extra = ["TEST_X"]

[[env]]
name = "test-bot"
kind = "custom"
parts = ["github"]

[[mate]]
name = "ada"
prompt = "p"
agent = "claude"
env = "test-bot"

[[mate]]
name = "bo"
prompt = "p"
agent = "claude"
`

func oldEnvHome(t *testing.T) (string, string) {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(oldEnvConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"secrets/env/test-bot/GH_TOKEN", "secrets/env/home/TEST_X", "envs/test-bot/gh/hosts.yml"} {
		full := filepath.Join(home, f)
		if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("TEST-value"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return home, path
}

func startMigrating(t *testing.T, path string) {
	t.Helper()
	start(t, &memStore{}, daemon.WithConfig(path), daemon.WithMachine("devbox"))
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestIdentityMigrationMovesTheConfigAndTheDirsOneTime(t *testing.T) {
	home, path := oldEnvHome(t)
	startMigrating(t, path)
	src, _ := os.ReadFile(path)
	text := string(src)
	for _, want := range []string{"# mine", "[[identity]]\nid = \"yours\"", "id = \"test-bot\"", "kind = \"separate\"", "identity_id = \"test-bot\"", "identity_id = \"yours\"", "[machine]"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in\n%s", want, text)
		}
	}
	if strings.Contains(text, "[[env]]") {
		t.Errorf("old tables stay:\n%s", text)
	}
	for _, f := range []string{"secrets/identity/test-bot/GH_TOKEN", "secrets/identity/yours/TEST_X", "identities/test-bot/gh/hosts.yml"} {
		if !exists(filepath.Join(home, f)) {
			t.Errorf("%s is not there", f)
		}
	}
	if exists(filepath.Join(home, "secrets/env/test-bot")) {
		t.Error("the old secret dir stays")
	}
	baks := backups(t, path)
	if len(baks) == 0 {
		t.Fatal("no backup")
	}
	old, _ := os.ReadFile(baks[0])
	if string(old) != oldEnvConfig {
		t.Errorf("the first backup is not the old config:\n%s", old)
	}
	startMigrating(t, path)
	again, _ := os.ReadFile(path)
	if string(again) != text || len(backups(t, path)) != len(baks) {
		t.Fatalf("the second start changed the config:\n%s", again)
	}
}

func TestIdentityMigrationKeepsTheOldFilesWhenAMoveFails(t *testing.T) {
	home, path := oldEnvHome(t)
	if err := os.WriteFile(filepath.Join(home, "identities"), []byte("in the way"), 0o600); err != nil {
		t.Fatal(err)
	}
	startMigrating(t, path)
	src, _ := os.ReadFile(path)
	if !strings.Contains(string(src), "[[env]]") || strings.Contains(string(src), "[[identity]]") {
		t.Fatalf("config changed:\n%s", src)
	}
	for _, f := range []string{"secrets/env/test-bot/GH_TOKEN", "secrets/env/home/TEST_X", "envs/test-bot/gh/hosts.yml"} {
		if !exists(filepath.Join(home, f)) {
			t.Errorf("%s is gone", f)
		}
	}
	if exists(filepath.Join(home, "secrets/identity/test-bot")) {
		t.Error("a move stays after the failure")
	}
}
