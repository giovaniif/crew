package daemon_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
)

const envMates = globalMates + `
[[env]]
name = "test-bot"
kind = "custom"
`

func TestMateSetKeepsTheEnvOfTheMate(t *testing.T) {
	c, path := mateDaemon(t, envMates)
	add := rpc.Mate{Name: "scout", Prompt: "Look.", Agent: "claude", Env: "test-bot", Enabled: true}
	if err := c.Call(context.Background(), rpc.MethodMateSet, rpc.MateSetParams{Mate: add}, nil); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `env = "test-bot"`) {
		t.Fatalf("config:\n%s", data)
	}
	list := listMates(t, c)
	if list.Mates[2].Env != "test-bot" {
		t.Errorf("list %+v", list.Mates[2])
	}
	local := rpc.Mate{Name: "local-one", Prompt: "Look.", Agent: "claude", Env: "local", Enabled: true}
	if err := c.Call(context.Background(), rpc.MethodMateSet, rpc.MateSetParams{Mate: local}, nil); err != nil {
		t.Fatalf("local env: %v", err)
	}
}

func TestMateSetRefusesAnUnknownEnv(t *testing.T) {
	c, path := mateDaemon(t, envMates)
	add := rpc.Mate{Name: "scout", Prompt: "Look.", Agent: "claude", Env: "nope", Enabled: true}
	err := c.Call(context.Background(), rpc.MethodMateSet, rpc.MateSetParams{Mate: add}, nil)
	if callCode(err) != rpc.CodeBadRequest || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("got %v", err)
	}
	if len(backups(t, path)) != 0 {
		t.Error("an unknown env wrote the file")
	}
}
