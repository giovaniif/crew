package envstore

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
)

func TestCodexLoginIsTheAuthFileInTheCodexDirOfTheEnvironment(t *testing.T) {
	s := Store{Home: t.TempDir()}
	if err := s.Save(domain.Environment{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvCodex}}); err != nil {
		t.Fatal(err)
	}
	if s.CodexLogin("bot") {
		t.Fatal("login before auth.json")
	}
	if err := os.WriteFile(filepath.Join(s.Home, "envs", "bot", "codex", "auth.json"), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !s.CodexLogin("bot") {
		t.Error("no login with auth.json")
	}
	if s.CodexLogin("../bot") || s.CodexLogin("other") {
		t.Error("login for a name that is not the environment")
	}
}
