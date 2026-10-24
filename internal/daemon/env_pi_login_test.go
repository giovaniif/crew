package daemon_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	_ "modernc.org/sqlite"
)

func TestEnvShowReportsAPiLoginInTheEnvironment(t *testing.T) {
	c, _, home := envDaemon(t, globalMates)
	if _, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvPi}}); err != nil {
		t.Fatal(err)
	}
	got, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || got.PiLogin {
		t.Fatalf("before login %+v, %v", got, err)
	}
	db, err := sql.Open("sqlite", filepath.Join(home, "envs", "bot", "omp", "agent.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec("CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, data TEXT, disabled_cause TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO auth_credentials (provider, data) VALUES ('anthropic', 'TEST')"); err != nil {
		t.Fatal(err)
	}
	got, err = envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || !got.PiLogin {
		t.Errorf("after login %+v, %v", got, err)
	}
}
