package envstore_test

import (
	"path/filepath"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
)

func TestPiLoginIsAnEnabledCredentialInTheAgentDBOfTheEnvironment(t *testing.T) {
	s := envstore.Store{Home: t.TempDir()}
	for _, name := range []string{"bot", "old"} {
		if err := s.Save(domain.Environment{Name: name, Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvPi}}); err != nil {
			t.Fatal(err)
		}
	}
	if s.PiLogin("bot") {
		t.Fatal("login before agent.db")
	}
	piDB(t, filepath.Join(s.Home, "envs", "old", "omp"), "'expired'")
	if s.PiLogin("old") {
		t.Error("login with only a disabled credential")
	}
	piDB(t, filepath.Join(s.Home, "envs", "bot", "omp"), "NULL")
	if !s.PiLogin("bot") {
		t.Error("no login with an enabled credential")
	}
	if s.PiLogin("../bot") || s.PiLogin("other") {
		t.Error("login for a name that is not the environment")
	}
}
