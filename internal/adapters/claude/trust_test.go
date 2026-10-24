package claude_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/claude"
)

func TestTheTrustFileIsInTheConfigDirElseInHome(t *testing.T) {
	env := map[string]string{"HOME": "/home/u"}
	if got := claude.TrustFile(func(k string) string { return env[k] }); got != "/home/u/.claude.json" {
		t.Errorf("no CLAUDE_CONFIG_DIR = %s", got)
	}
	env["CLAUDE_CONFIG_DIR"] = "/cfg"
	if got := claude.TrustFile(func(k string) string { return env[k] }); got != "/cfg/.claude.json" {
		t.Errorf("CLAUDE_CONFIG_DIR = %s", got)
	}
}

func TestTrustSetsTheFlagOfClaudeKeepsTheRestAndBacksUpFirst(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, ".claude.json")
	first := `{"theme":"dark","numStartups":3,"projects":{"/srv/web":{"hasTrustDialogAccepted":true,"lastCost":1.5},"/srv/api":{"lastCost":2}}}`
	if err := os.WriteFile(file, []byte(first), 0o600); err != nil {
		t.Fatal(err)
	}
	tr := claude.Trust{File: file}
	if ok, err := tr.Trusted("/srv/web/sub"); err != nil || !ok {
		t.Fatalf("Trusted(web/sub) = %v, %v", ok, err)
	}
	if ok, err := tr.Trusted("/srv/api"); err != nil || ok {
		t.Fatalf("Trusted(api) = %v, %v", ok, err)
	}
	if err := tr.TrustDir("/srv/api"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := tr.Trusted("/srv/api"); !ok {
		t.Fatal("api is not trusted after Trust")
	}
	var got map[string]any
	b, _ := os.ReadFile(file)
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	api := got["projects"].(map[string]any)["/srv/api"].(map[string]any)
	if got["theme"] != "dark" || got["numStartups"] != 3.0 || api["lastCost"] != 2.0 || api["hasTrustDialogAccepted"] != true {
		t.Errorf("file after trust = %s", b)
	}
	if info, _ := os.Stat(file); info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", info.Mode())
	}
	backups, _ := filepath.Glob(file + ".crew-*.bak")
	if len(backups) != 1 {
		t.Fatalf("backups = %v", backups)
	}
	if b, _ := os.ReadFile(backups[0]); string(b) != first {
		t.Errorf("backup = %s", b)
	}
	if err := tr.TrustDir("/srv/api"); err != nil {
		t.Fatal(err)
	}
	if again, _ := filepath.Glob(file + ".crew-*.bak"); len(again) != 1 {
		t.Errorf("a second trust wrote again: %v", again)
	}
}

func TestTrustMakesTheFileWhenClaudeNeverRan(t *testing.T) {
	file := filepath.Join(t.TempDir(), "cfg", ".claude.json")
	tr := claude.Trust{File: file}
	if ok, err := tr.Trusted("/srv/api"); err != nil || ok {
		t.Fatalf("Trusted with no file = %v, %v", ok, err)
	}
	if err := tr.TrustDir("/srv/api"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := tr.Trusted("/srv/api"); !ok {
		t.Error("not trusted after Trust")
	}
}

func TestTrustRefusesAFileThatIsNotJSON(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".claude.json")
	if err := os.WriteFile(file, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := claude.Trust{File: file}.TrustDir("/srv/api")
	if err == nil || !strings.Contains(err.Error(), file) {
		t.Errorf("err = %v", err)
	}
	if b, _ := os.ReadFile(file); string(b) != "not json" {
		t.Errorf("file changed: %s", b)
	}
}
