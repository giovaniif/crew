package codex

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

type seededConfig struct {
	ModelProvider  string                       `toml:"model_provider"`
	Model          string                       `toml:"model"`
	ModelProviders map[string]map[string]string `toml:"model_providers"`
	Projects       map[string]map[string]string `toml:"projects"`
}

func decodeSeed(t *testing.T, dir string) seededConfig {
	t.Helper()
	var c seededConfig
	if _, err := toml.DecodeFile(filepath.Join(dir, "config.toml"), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestSeedFreshCodexHomeUsesTheEnvKeyAndTrustsTheProjects(t *testing.T) {
	dir := t.TempDir()
	changed, err := Seed(dir, []string{"/w/api", `/w/a "b"`})
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	c := decodeSeed(t, dir)
	p := c.ModelProviders[c.ModelProvider]
	if p["env_key"] != "OPENAI_API_KEY" || p["base_url"] != "https://api.openai.com/v1" || p["wire_api"] != "responses" {
		t.Errorf("provider %q = %v", c.ModelProvider, p)
	}
	for _, d := range []string{"/w/api", `/w/a "b"`} {
		if c.Projects[d]["trust_level"] != "trusted" {
			t.Errorf("%s: %v", d, c.Projects[d])
		}
	}
}

func TestSeedMergesIntoAConfigAndASecondRunChangesNothing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	orig := "model = \"gpt-test\"\n\n[projects.\"/w/old\"]\ntrust_level = \"untrusted\"\n"
	if err := os.WriteFile(path, []byte(orig), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(dir, []string{"/w/old", "/w/api"}); err != nil {
		t.Fatal(err)
	}
	c := decodeSeed(t, dir)
	if c.Model != "gpt-test" || c.Projects["/w/old"]["trust_level"] != "untrusted" || c.Projects["/w/api"]["trust_level"] != "trusted" {
		t.Errorf("merge lost a value: %+v", c)
	}
	if c.ModelProviders[c.ModelProvider]["env_key"] != "OPENAI_API_KEY" {
		t.Errorf("provider = %+v", c)
	}
	backups, _ := filepath.Glob(path + ".crew-*.bak")
	if len(backups) != 1 {
		t.Fatalf("backups = %v", backups)
	}
	if b, _ := os.ReadFile(backups[0]); string(b) != orig {
		t.Errorf("backup = %q", b)
	}
	before, _ := os.ReadFile(path)
	changed, err := Seed(dir, []string{"/w/old", "/w/api"})
	after, _ := os.ReadFile(path)
	if err != nil || changed || string(before) != string(after) {
		t.Errorf("second run: changed=%v err=%v", changed, err)
	}
}

func TestSeedKeepsTheProviderThatTheUserSelected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("model_provider = \"mine\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(dir, nil); err != nil {
		t.Fatal(err)
	}
	if c := decodeSeed(t, dir); c.ModelProvider != "mine" {
		t.Errorf("model_provider = %q", c.ModelProvider)
	}
}

func TestSeedRefusesAConfigThatDoesNotParse(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("[[nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(dir, nil); err == nil {
		t.Error("a broken config.toml was changed")
	}
	if b, _ := os.ReadFile(path); !strings.HasPrefix(string(b), "[[nope") {
		t.Errorf("file = %q", b)
	}
}
