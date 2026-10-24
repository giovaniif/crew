package onboard_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/claude"
	"github.com/giovaniif/crew/internal/domain"
)

var local = domain.Environment{Name: "local", Kind: domain.EnvLocal}

func TestAMachineWithNoHarnessHasNoMissingHooks(t *testing.T) {
	w := newWorld(t, false)
	if got := w.probe.Hooks(context.Background(), nil); len(got) != 0 {
		t.Errorf("hooks = %+v, want none", got)
	}
}

func TestClaudeHooksThatWereNeverSetUpAreReportedWhenClaudeIsUsed(t *testing.T) {
	ctx := context.Background()
	w := newWorld(t, false)
	w.probe.UserHome = w.root
	write(t, w.probe.ClaudeSettings, `{"theme":"dark"}`)
	want := domain.HooksMissing{Env: "local", Harness: domain.HarnessClaude, File: w.probe.ClaudeSettings, Reason: "crew hooks are not set up in ~/claude/settings.json", New: true}
	if got := w.probe.Hooks(ctx, nil); len(got) != 1 || got[0] != want {
		t.Fatalf("hooks with a claude config = %+v, want %+v", got, want)
	}
	if err := w.probe.FixHooks(ctx, local, domain.HarnessClaude); err != nil {
		t.Fatal(err)
	}
	if got := w.probe.Hooks(ctx, nil); len(got) != 0 {
		t.Errorf("hooks after set up = %+v, want none", got)
	}
	if b, _ := os.ReadFile(claude.BackupPath(w.probe.ClaudeSettings)); !strings.Contains(string(b), `"dark"`) {
		t.Errorf("backup = %s, want the first file", b)
	}

	p := newWorld(t, false)
	p.probe.LookPath = func(name string) (string, error) {
		if name == "claude" {
			return "/usr/bin/claude", nil
		}
		return "", os.ErrNotExist
	}
	if got := p.probe.Hooks(ctx, nil); len(got) != 1 || !got[0].New || got[0].Harness != domain.HarnessClaude {
		t.Errorf("hooks with claude on PATH = %+v, want claude not set up", got)
	}
}

func TestHooksThatAnotherToolRemovedAreReportedAndFixed(t *testing.T) {
	w := newWorld(t, false)
	w.probe.UserHome = w.root
	ctx := context.Background()
	write(t, w.probe.ClaudeSettings, `{"theme":"dark"}`)
	for _, h := range []domain.Harness{domain.HarnessClaude, domain.HarnessCodex, domain.HarnessOmp} {
		if _, err := w.probe.Install(ctx, h); err != nil {
			t.Fatal(err)
		}
	}
	if got := w.probe.Hooks(ctx, nil); len(got) != 0 {
		t.Fatalf("hooks after install = %+v, want none", got)
	}
	write(t, w.probe.ClaudeSettings, `{"theme":"light"}`)
	got := w.probe.Hooks(ctx, nil)
	want := domain.HooksMissing{Env: "local", Harness: domain.HarnessClaude, File: w.probe.ClaudeSettings, Reason: "crew hooks are missing in ~/claude/settings.json"}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("hooks = %+v, want %+v", got, want)
	}
	if err := w.probe.FixHooks(ctx, local, domain.HarnessClaude); err != nil {
		t.Fatal(err)
	}
	if got := w.probe.Hooks(ctx, nil); len(got) != 0 {
		t.Errorf("hooks after fix = %+v, want none", got)
	}
	b, _ := os.ReadFile(w.probe.ClaudeSettings)
	if !strings.Contains(string(b), `"light"`) || !strings.Contains(string(b), claude.HookCommand(bin, "Stop")) {
		t.Errorf("settings after fix = %s", b)
	}
	if b, _ := os.ReadFile(claude.BackupPath(w.probe.ClaudeSettings)); !strings.Contains(string(b), `"dark"`) {
		t.Errorf("backup = %s, want the first file", b)
	}
}

func TestASeededCustomEnvironmentIsCheckedAndFixed(t *testing.T) {
	w := newWorld(t, false)
	ctx := context.Background()
	work := domain.Environment{Name: "work", Kind: domain.EnvCustom, Home: filepath.Join(w.root, "envs", "work"), Parts: []domain.EnvPart{domain.EnvClaude, domain.EnvCodex}}
	settings := filepath.Join(work.Home, "claude", "settings.json")
	write(t, settings, `{}`)
	got := w.probe.Hooks(ctx, []domain.Environment{local, work})
	if len(got) != 1 || got[0].Env != "work" || got[0].Harness != domain.HarnessClaude || got[0].File != settings {
		t.Fatalf("hooks = %+v, want claude of work only", got)
	}
	if err := w.probe.FixHooks(ctx, work, domain.HarnessClaude); err != nil {
		t.Fatal(err)
	}
	if got := w.probe.Hooks(ctx, []domain.Environment{work}); len(got) != 0 {
		t.Errorf("hooks after fix = %+v", got)
	}
	if _, err := os.Stat(w.probe.ClaudeSettings); err == nil {
		t.Error("fix of a custom environment wrote the local settings")
	}
	if err := w.probe.FixHooks(ctx, work, domain.HarnessOmp); err == nil {
		t.Error("fix of a harness that the environment does not have succeeded")
	}
}
