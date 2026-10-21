package daemon_test

import (
	"context"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
)

func TestDebugSeedWorktreesCanBeAssignedByTheirListedPath(t *testing.T) {
	_, path := start(t, &memStore{})
	ctx := context.Background()
	if err := dial(t, path).DebugSeed(ctx, rpc.DebugSeedParams{Count: 3}); err != nil {
		t.Fatal(err)
	}
	sub, err := dial(t, path).Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sub.State.Worktrees) == 0 {
		t.Fatal("no seeded worktrees")
	}
	for _, w := range sub.State.Worktrees {
		if err := dial(t, path).WorktreeAssign(ctx, w.Path, "seed-session-2"); err != nil {
			t.Fatalf("assign %s: %v", w.Path, err)
		}
	}
}
