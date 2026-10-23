package codex

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeedWithAChatGPTLoginKeepsTheDefaultProvider(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"auth_mode":"chatgpt","tokens":{"access_token":"TEST"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(dir, []string{"/w/api"}); err != nil {
		t.Fatal(err)
	}
	c := decodeSeed(t, dir)
	if c.ModelProvider != "" {
		t.Errorf("model_provider = %q, want the default", c.ModelProvider)
	}
	if c.Projects["/w/api"]["trust_level"] != "trusted" {
		t.Errorf("projects %v", c.Projects)
	}
}

func TestSeedAfterAChatGPTLoginDropsTheEnvKeyProviderItSetBefore(t *testing.T) {
	dir := t.TempDir()
	if _, err := Seed(dir, []string{"/w/api"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"auth_mode":"chatgpt"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := Seed(dir, []string{"/w/api"})
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if c := decodeSeed(t, dir); c.ModelProvider != "" {
		t.Errorf("model_provider = %q, want the default", c.ModelProvider)
	}
	if changed, err := Seed(dir, []string{"/w/api"}); err != nil || changed {
		t.Errorf("second run changed=%v err=%v", changed, err)
	}
}

func TestSeedWithAChatGPTLoginKeepsAProviderTheUserChose(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte("model_provider = \"azure\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(dir, nil); err != nil {
		t.Fatal(err)
	}
	if c := decodeSeed(t, dir); c.ModelProvider != "azure" {
		t.Errorf("model_provider = %q", c.ModelProvider)
	}
}
