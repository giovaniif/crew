package daemon_test

import (
	"context"
	"errors"
	"testing"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func freshRig(t *testing.T) (mateRig, string, domain.Session) {
	t.Helper()
	r, memory := localRig(t)
	var old domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper"}, &old); err != nil {
		t.Fatal(err)
	}
	return r, memory, old
}

func (r mateRig) worktreesAdded() int {
	r.wts.mu.Lock()
	defer r.wts.mu.Unlock()
	return len(r.wts.added)
}

func TestMateFreshAsksTheOldSessionForAHandoffAndStartsANewConversation(t *testing.T) {
	r, memory, old := freshRig(t)
	var fresh domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateFresh, rpc.MateFreshParams{Session: old.ID}, &fresh); err != nil {
		t.Fatal(err)
	}
	if fresh.ID == old.ID || fresh.Mate == nil || fresh.Mate.Name != "helper" || !fresh.Mate.Local {
		t.Fatalf("fresh %+v", fresh)
	}
	if r.worktreesAdded() != 2 {
		t.Fatalf("worktrees %d, want a new one", r.worktreesAdded())
	}
	waitFor(t, func() bool { return r.typed(domain.MateHandoffPrompt(memory)) })
	for _, s := range r.mateSessions(t) {
		if s.ID == old.ID && s.Ended {
			t.Fatal("the old session ended")
		}
	}
}

func TestMateFreshInTheSameWorktreeStartsInTheOldDir(t *testing.T) {
	r, _, old := freshRig(t)
	var fresh domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateFresh, rpc.MateFreshParams{Session: old.ID, SameWorktree: true}, &fresh); err != nil {
		t.Fatal(err)
	}
	if fresh.Dir != old.Dir || r.worktreesAdded() != 1 {
		t.Fatalf("fresh dir %q, old %q, worktrees %d", fresh.Dir, old.Dir, r.worktreesAdded())
	}
}

func TestMateFreshMarksTheNewSessionWithTheOldOne(t *testing.T) {
	r, _, old := freshRig(t)
	var fresh domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateFresh, rpc.MateFreshParams{Session: old.ID, SameWorktree: true}, &fresh); err != nil {
		t.Fatal(err)
	}
	if fresh.Mate == nil || fresh.Mate.FreshFrom != old.ID {
		t.Fatalf("fresh seat %+v, want fresh from %q", fresh.Mate, old.ID)
	}
	for _, s := range r.mateSessions(t) {
		if s.ID == fresh.ID && s.Mate.FreshFrom != old.ID {
			t.Fatalf("the sessions lost the marker: %+v", s.Mate)
		}
		if s.ID == old.ID && s.Mate.FreshFrom != "" {
			t.Fatalf("the old session is marked: %+v", s.Mate)
		}
	}
}

func TestMateFreshOfAnUnknownSessionIsNotFound(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateFresh, rpc.MateFreshParams{Session: "nope"}, nil)
	var rerr *rpc.Error
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeNotFound {
		t.Fatalf("err %v", err)
	}
}

func TestMateFreshOfASessionThatIsNotAMateIsABadRequest(t *testing.T) {
	r := startMateRigWith(t, &memStore{snap: app.Snapshot{Sessions: []domain.Session{{ID: "plain", Harness: domain.HarnessClaude, Pane: "%9", Dir: "/w/api", State: domain.StateIdle}}}}, localMates)
	err := r.c.Call(context.Background(), rpc.MethodMateFresh, rpc.MateFreshParams{Session: "plain"}, nil)
	var rerr *rpc.Error
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeBadRequest {
		t.Fatalf("err %v", err)
	}
}
