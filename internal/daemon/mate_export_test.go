package daemon_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/adapters/secrets"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const (
	exportBot = "xoxb-TEST-zzexportbotzz"
	exportApp = "xapp-TEST-zzexportappzz"
)

func exportDaemon(t *testing.T) *rpc.Client {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(globalMates), 0o600); err != nil {
		t.Fatal(err)
	}
	_, sock := start(t, &memStore{}, daemon.WithWorkspaces(shop, shopGit), daemon.WithConfig(path),
		daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithMateSecrets(secrets.Files{Dir: filepath.Join(home, "secrets")}),
		daemon.WithMachine("devbox"))
	c := dial(t, sock)
	if _, err := c.WorkspaceAdd(context.Background(), "/shop"); err != nil {
		t.Fatal(err)
	}
	return c
}

func exportOf(t *testing.T, c *rpc.Client, name string) (rpc.MateExport, []byte) {
	t.Helper()
	var raw json.RawMessage
	if err := c.Call(context.Background(), rpc.MethodMateExport, rpc.MateNameParams{Name: name}, &raw); err != nil {
		t.Fatal(err)
	}
	var out rpc.MateExport
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out, raw
}

func TestMateExportHasTheRoleTheMemoryAndTheLookButNoSecret(t *testing.T) {
	c := exportDaemon(t)
	ctx := context.Background()
	if _, err := setTokens(c, "reviewer", exportBot, exportApp); err != nil {
		t.Fatal(err)
	}
	if err := c.Call(ctx, rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "reviewer", Text: "TEST note"}, nil); err != nil {
		t.Fatal(err)
	}
	got, raw := exportOf(t, c, "reviewer")
	if got.Mate.Name != "reviewer" || got.Mate.Prompt != "Review code." || got.Mate.Agent != "claude" || got.Memory != "TEST note" {
		t.Fatalf("export %+v", got)
	}
	if got.Mate.Owner != "" || got.Mate.Env != "" || got.Mate.Machine != "" {
		t.Errorf("export keeps machine data: %+v", got.Mate)
	}
	if strings.Contains(string(raw), "zzexport") || strings.Contains(string(raw), "xoxb-") || strings.Contains(string(raw), "xapp-") {
		t.Fatalf("export holds a token: %s", raw)
	}
}

func machineOf(t *testing.T, c *rpc.Client) string {
	t.Helper()
	st, err := c.Status(context.Background())
	if err != nil || st.Machine == nil {
		t.Fatalf("status %+v %v", st, err)
	}
	return st.Machine.ID
}

func TestMateImportKeepsAFreeNameAndNumbersAUsedName(t *testing.T) {
	source := exportDaemon(t)
	ctx := context.Background()
	if err := source.Call(ctx, rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "reviewer", Text: "TEST note"}, nil); err != nil {
		t.Fatal(err)
	}
	export, _ := exportOf(t, source, "reviewer")
	target := exportDaemon(t)
	env := &rpc.MateEnvironment{MachineID: machineOf(t, target), IdentityID: domain.IdentityYours}
	for _, want := range []string{"reviewer-2", "reviewer-3"} {
		var got domain.Mate
		if err := target.Call(ctx, rpc.MethodMateImport, rpc.MateImportParams{Export: export, Environment: env}, &got); err != nil {
			t.Fatal(err)
		}
		if got.Name != want || got.Prompt != "Review code." {
			t.Fatalf("got %+v, want %s", got, want)
		}
		var mem rpc.MateMemory
		if err := target.Call(ctx, rpc.MethodMateMemory, rpc.MateSetMemoryParams{Name: want}, &mem); err != nil || mem.Text != "TEST note" {
			t.Fatalf("memory %+v %v", mem, err)
		}
	}
	export.Mate.Name = "fresh"
	var got domain.Mate
	if err := target.Call(ctx, rpc.MethodMateImport, rpc.MateImportParams{Export: export, Environment: env}, &got); err != nil || got.Name != "fresh" {
		t.Fatalf("free name: %+v %v", got, err)
	}
}

func TestMateImportRefusesAnEnvironmentOfADifferentMachine(t *testing.T) {
	c := exportDaemon(t)
	export, _ := exportOf(t, c, "reviewer")
	var rerr *rpc.Error
	err := c.Call(context.Background(), rpc.MethodMateImport, rpc.MateImportParams{Export: export, Environment: &rpc.MateEnvironment{MachineID: "m-other", IdentityID: domain.IdentityYours}}, nil)
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeWrongMachine {
		t.Fatalf("err %v", err)
	}
}
