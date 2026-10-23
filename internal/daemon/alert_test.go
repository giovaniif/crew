package daemon_test

import (
	"context"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
)

func TestAFailingPROfASessionPutsOneAlertInTheState(t *testing.T) {
	r := startScheduleRig(t, "", time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC), nil)
	owned := func(checks domain.CheckState) domain.Worktree {
		wt := shopWorktree(checks)
		wt.SessionID = "s1"
		return wt
	}
	r.d.Post(daemon.WorktreeChanged{Worktree: owned(domain.CheckPending)})
	r.d.Post(daemon.WorktreeChanged{Worktree: owned(domain.CheckFailing)})
	r.d.Post(daemon.WorktreeChanged{Worktree: owned(domain.CheckFailing)})
	alerts := func() []domain.Alert {
		sub, err := r.c.Subscribe(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return sub.State.Alerts
	}
	waitUntil(t, "an alert", func() bool { return len(alerts()) > 0 })
	time.Sleep(60 * time.Millisecond)
	if got := alerts(); len(got) != 1 || got[0].Kind != domain.AlertPRChecksFailed || got[0].Session != "s1" {
		t.Errorf("alerts = %+v", got)
	}
}
