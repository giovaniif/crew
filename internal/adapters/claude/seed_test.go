package claude_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/claude"
)

func readState(t *testing.T, dir string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, ".claude.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestSeedFreshDirSkipsOnboardingAndTrustsTheProjects(t *testing.T) {
	dir := t.TempDir()
	changed, err := claude.Seed(dir, []string{"/w/api", "/w/web"}, "")
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	doc := readState(t, dir)
	if doc["hasCompletedOnboarding"] != true {
		t.Errorf("hasCompletedOnboarding = %v", doc["hasCompletedOnboarding"])
	}
	projects := doc["projects"].(map[string]any)
	for _, p := range []string{"/w/api", "/w/web"} {
		if projects[p].(map[string]any)["hasTrustDialogAccepted"] != true {
			t.Errorf("%s is not trusted: %v", p, projects[p])
		}
	}
	if _, ok := doc["customApiKeyResponses"]; ok {
		t.Error("an OAuth env got an API key approval")
	}
	info, _ := os.Stat(filepath.Join(dir, ".claude.json"))
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", info.Mode().Perm())
	}
}

func TestSeedApprovesTheLastTwentyCharsOfTheAPIKey(t *testing.T) {
	dir := t.TempDir()
	key := "TEST-not-real-0123456789abcdefghij"
	tail := key[len(key)-20:]
	seed := `{"customApiKeyResponses":{"approved":["other"],"rejected":["` + tail + `"]}}`
	if err := os.WriteFile(filepath.Join(dir, ".claude.json"), []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := claude.Seed(dir, nil, key); err != nil {
		t.Fatal(err)
	}
	resp := readState(t, dir)["customApiKeyResponses"].(map[string]any)
	var approved, rejected []string
	for _, v := range resp["approved"].([]any) {
		approved = append(approved, v.(string))
	}
	for _, v := range resp["rejected"].([]any) {
		rejected = append(rejected, v.(string))
	}
	if !slices.Equal(approved, []string{"other", tail}) {
		t.Errorf("approved = %v", approved)
	}
	if slices.Contains(rejected, tail) {
		t.Errorf("rejected still has the key: %v", rejected)
	}
}

func TestSeedKeepsOtherKeysBacksUpAndASecondRunChangesNothing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".claude.json")
	orig := `{"theme":"light","projects":{"/w/api":{"allowedTools":["x"]}}}`
	if err := os.WriteFile(path, []byte(orig), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := claude.Seed(dir, []string{"/w/api"}, "TEST-key"); err != nil {
		t.Fatal(err)
	}
	doc := readState(t, dir)
	if doc["theme"] != "light" {
		t.Errorf("theme lost: %v", doc)
	}
	api := doc["projects"].(map[string]any)["/w/api"].(map[string]any)
	if api["allowedTools"] == nil || api["hasTrustDialogAccepted"] != true {
		t.Errorf("project entry = %v", api)
	}
	backup, err := os.ReadFile(path + ".crew-backup")
	if err != nil || string(backup) != orig {
		t.Errorf("backup = %q, %v", backup, err)
	}
	before, _ := os.ReadFile(path)
	changed, err := claude.Seed(dir, []string{"/w/api"}, "TEST-key")
	after, _ := os.ReadFile(path)
	if err != nil || changed || string(before) != string(after) {
		t.Errorf("second run: changed=%v err=%v", changed, err)
	}
}

func TestSeedRefusesAStateFileThatDoesNotParse(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".claude.json"), []byte("{nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := claude.Seed(dir, nil, ""); err == nil {
		t.Error("a broken .claude.json was overwritten")
	}
}
