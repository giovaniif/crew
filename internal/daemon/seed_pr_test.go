package daemon_test

import (
	"context"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestDebugSeedPRsAreOpenAndHaveAURL(t *testing.T) {
	_, path := start(t, &memStore{})
	ctx := context.Background()
	if err := dial(t, path).DebugSeed(ctx, rpc.DebugSeedParams{Count: 3}); err != nil {
		t.Fatal(err)
	}
	sub, err := dial(t, path).Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	prs := 0
	for _, w := range sub.State.Worktrees {
		if w.PR == nil {
			continue
		}
		prs++
		if w.PR.State != domain.PROpen || w.PR.URL == "" {
			t.Errorf("PR #%d state %q url %q", w.PR.Number, w.PR.State, w.PR.URL)
		}
	}
	if prs != 3 {
		t.Fatalf("prs %d", prs)
	}
}
