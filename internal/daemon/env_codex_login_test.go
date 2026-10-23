package daemon_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestEnvShowReportsACodexChatGPTLoginInTheEnvironment(t *testing.T) {
	c, _, home := envDaemon(t, globalMates)
	if _, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvCodex}}); err != nil {
		t.Fatal(err)
	}
	got, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || got.CodexLogin {
		t.Fatalf("before login %+v, %v", got, err)
	}
	if err := os.WriteFile(filepath.Join(home, "envs", "bot", "codex", "auth.json"), []byte(`{"auth_mode":"chatgpt"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err = envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || !got.CodexLogin {
		t.Errorf("after login %+v, %v", got, err)
	}
}
