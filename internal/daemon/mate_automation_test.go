package daemon_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const mateAutomations = envLaunchMates + `
[[automation]]
name = "weekly"
mate = "codex-bot"
agent = "claude"
prompt = "TEST check the deps"

[[automation]]
name = "ghost"
mate = "nobody"
prompt = "TEST nothing"
`

func runMateAutomation(t *testing.T, r mateRig, name string) rpc.AutomationRunResult {
	t.Helper()
	var got rpc.AutomationRunResult
	if err := r.c.Call(context.Background(), rpc.MethodAutomationRun, rpc.AutomationRunParams{Name: name}, &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func TestAutomationWithAMateRunsAsThatMate(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, mateAutomations, daemon.WithEnvLauncher("/opt/crew"))
	got := runMateAutomation(t, r, "weekly")
	if got.Run.Outcome != domain.AutomationSucceeded {
		t.Fatalf("run %+v", got.Run)
	}
	seat := got.Session.Mate
	if seat == nil || seat.Name != "codex-bot" || !seat.Local || seat.Automation != "weekly" {
		t.Fatalf("seat %+v", seat)
	}
	if got.Session.Harness != "codex" {
		t.Errorf("harness %q, want the harness of the mate", got.Session.Harness)
	}
	cmd := lastSpec(r)
	if len(cmd) <= len(envPrefix) || !slices.Equal(cmd[:len(envPrefix)], envPrefix) || cmd[len(envPrefix)] != "codex" {
		t.Errorf("command %q", cmd)
	}
	if !strings.Contains(strings.Join(cmd, " "), "You help.") {
		t.Errorf("command %q has no role prompt of the mate", cmd)
	}
}

func TestAutomationWithAnUnknownMateFailsTheRun(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, mateAutomations, daemon.WithEnvLauncher("/opt/crew"))
	got := runMateAutomation(t, r, "ghost")
	if got.Run.Outcome != domain.AutomationFailed || !strings.Contains(got.Run.Reason, "nobody") {
		t.Fatalf("run %+v", got.Run)
	}
}

func TestMateRemoveRefusesAMateThatAnAutomationNames(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, mateAutomations)
	err := r.c.Call(context.Background(), rpc.MethodMateRemove, rpc.MateRemoveParams{Name: "codex-bot"}, nil)
	if err == nil || !strings.Contains(err.Error(), "used by automation weekly") {
		t.Fatalf("got %v", err)
	}
	var list rpc.MateList
	if err := r.c.Call(context.Background(), rpc.MethodMateList, nil, &list); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(list.Mates, func(m domain.Mate) bool { return m.Name == "codex-bot" }) {
		t.Error("the mate went")
	}
}

func TestAutomationShowGivesTheMate(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, mateAutomations)
	var a domain.Automation
	if err := r.c.Call(context.Background(), rpc.MethodAutomationShow, rpc.AutomationShowParams{Name: "weekly"}, &a); err != nil {
		t.Fatal(err)
	}
	if a.Mate != "codex-bot" {
		t.Fatalf("got %+v", a)
	}
}
