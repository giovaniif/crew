package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/daemon"
)

func machineStatus(t *testing.T, path string) (string, string) {
	t.Helper()
	_, sock := start(t, &memStore{}, daemon.WithConfig(path), daemon.WithMachine("devbox"))
	st, err := dial(t, sock).Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.Machine == nil {
		t.Fatal("status has no machine")
	}
	return st.Machine.ID, st.Machine.Name
}

func TestMachineIDIsWrittenOnTheFirstStartAndKeptOnLaterStarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("# mine\n[fallback]\nthreshold = 30\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, name := machineStatus(t, path)
	if len(first) < 16 || name != "devbox" {
		t.Fatalf("machine = %q %q", first, name)
	}
	src, _ := os.ReadFile(path)
	if !strings.Contains(string(src), "[machine]") || !strings.Contains(string(src), first) || !strings.Contains(string(src), "# mine") {
		t.Fatalf("config.toml = %s", src)
	}
	if len(backups(t, path)) != 1 {
		t.Fatalf("backups = %v", backups(t, path))
	}
	again, _ := machineStatus(t, path)
	if again != first {
		t.Fatalf("second start id %q, want %q", again, first)
	}
	if len(backups(t, path)) != 1 {
		t.Fatalf("the second start wrote again: %v", backups(t, path))
	}
}

func TestMachineIDsOfTwoDaemonsDiffer(t *testing.T) {
	a, _ := machineStatus(t, filepath.Join(t.TempDir(), "config.toml"))
	b, _ := machineStatus(t, filepath.Join(t.TempDir(), "config.toml"))
	if a == b {
		t.Fatalf("both ids are %q", a)
	}
}
