package daemon_test

import (
	"context"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
)

func TestDebugSeedWorktreesBelongToTheSessionThatListsThem(t *testing.T) {
	_, path := start(t, &memStore{})
	ctx := context.Background()
	if err := dial(t, path).DebugSeed(ctx, rpc.DebugSeedParams{Count: 3}); err != nil {
		t.Fatal(err)
	}
	sub, err := dial(t, path).Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner := map[string]string{}
	for _, s := range sub.State.Sessions {
		for _, id := range s.WorktreeIDs {
			owner[id] = s.ID
		}
	}
	if len(sub.State.Worktrees) == 0 {
		t.Fatal("no seeded worktrees")
	}
	for _, w := range sub.State.Worktrees {
		if w.SessionID == "" || w.SessionID != owner[w.ID] {
			t.Fatalf("worktree %s has owner %q, listed by %q", w.ID, w.SessionID, owner[w.ID])
		}
	}
}
