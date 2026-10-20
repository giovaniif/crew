//go:build integration

package tmux_test

import (
	"context"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/app"
)

const tabSwitchBudget = 60 * time.Millisecond

func TestTabSwitchSwapsEachTabIntoTheSlotAndKeepsTheOthersAlive(t *testing.T) {
	ctx := context.Background()
	h := newHost(t)
	slot, err := h.OpenClient(ctx, "main", app.PaneSpec{Name: "tui", Command: []string{"sleep", "600"}})
	if err != nil {
		t.Fatal(err)
	}
	var tabs []app.PaneID
	for _, name := range []string{"agent", "shell", "agent-2"} {
		pane, err := h.Create(ctx, app.PaneSpec{Name: name, Command: []string{"sleep", "600"}})
		if err != nil {
			t.Fatal(err)
		}
		tabs = append(tabs, pane)
	}
	fastestRound := time.Duration(1<<63 - 1)
	for round := range 3 {
		var slowest time.Duration
		for _, pane := range tabs {
			began := time.Now()
			if err := h.Show(ctx, pane, slot); err != nil {
				t.Fatal(err)
			}
			slowest = max(slowest, time.Since(began))
			if got := h.ShownIn(ctx, slot); got != pane {
				t.Fatalf("round %d: slot shows %s, want %s", round, got, pane)
			}
		}
		fastestRound = min(fastestRound, slowest)
	}
	for _, pane := range tabs {
		if alive, err := h.Alive(ctx, pane); err != nil || !alive {
			t.Fatalf("tab %s died while switching: %v", pane, err)
		}
	}
	if fastestRound > tabSwitchBudget {
		t.Errorf("the slowest tab switch of the fastest round took %v; the budget is %v", fastestRound, tabSwitchBudget)
	}
}
