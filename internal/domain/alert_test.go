package domain

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

var alertAt = time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)

func ownedPR(session string, number int, checks CheckState, failing ...string) Worktree {
	pr := &PullRequest{Number: number, Title: "Add login", URL: fmt.Sprintf("https://github.com/o/web/pull/%d", number), State: PROpen, Checks: checks}
	for _, f := range failing {
		pr.Failing = append(pr.Failing, FailingCheck{Name: f})
	}
	return Worktree{ID: "/src/web-login", Repo: "/src/web", Branch: "feat/login", SessionID: session, PR: pr}
}

func TestPRChecksAlertFiresOnlyWhenTheChecksOfAnOwnedPRTurnRed(t *testing.T) {
	noPR := Worktree{ID: "/src/web-login", SessionID: "s1"}
	cases := []struct {
		name string
		old  *Worktree
		now  Worktree
		want bool
	}{
		{"pending to failing", &[]Worktree{ownedPR("s1", 42, CheckPending)}[0], ownedPR("s1", 42, CheckFailing), true},
		{"new worktree already failing", nil, ownedPR("s1", 42, CheckFailing), true},
		{"no PR before", &noPR, ownedPR("s1", 42, CheckFailing), true},
		{"stays failing", &[]Worktree{ownedPR("s1", 42, CheckFailing)}[0], ownedPR("s1", 42, CheckFailing), false},
		{"another PR on the branch", &[]Worktree{ownedPR("s1", 41, CheckFailing)}[0], ownedPR("s1", 42, CheckFailing), true},
		{"passing", &[]Worktree{ownedPR("s1", 42, CheckPending)}[0], ownedPR("s1", 42, CheckPassing), false},
		{"no session owns it", &[]Worktree{ownedPR("", 42, CheckPending)}[0], ownedPR("", 42, CheckFailing), false},
		{"no PR", nil, noPR, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, ok := PRChecksAlert(c.old, c.now, alertAt)
			if ok != c.want {
				t.Errorf("ok = %v, want %v", ok, c.want)
			}
		})
	}
}

func TestPRChecksAlertNamesThePRAndTheFailingChecks(t *testing.T) {
	got, _ := PRChecksAlert(nil, ownedPR("s1", 42, CheckFailing, "lint", "test"), alertAt)
	want := Alert{
		ID: "pr_checks_failed:https://github.com/o/web/pull/42@2026-10-23T09:00:00Z", Kind: AlertPRChecksFailed,
		Title: "PR #42 checks failed", Body: "Add login · lint, test", Session: "s1", At: alertAt,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	plain, _ := PRChecksAlert(nil, ownedPR("s1", 7, CheckFailing), alertAt)
	if plain.Body != "Add login" {
		t.Errorf("body with no names = %q", plain.Body)
	}
}

func TestAutomationAlertFiresOnlyForAFailedRun(t *testing.T) {
	run := AutomationRun{ID: "r1", Automation: "fix-ci", Outcome: AutomationFailed, Reason: "no such repo", End: alertAt}
	got, ok := AutomationAlert(run)
	want := Alert{ID: "automation_failed:r1", Kind: AlertAutomationFailed, Title: "Automation fix-ci failed", Body: "no such repo", At: alertAt}
	if !ok || !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v %v\nwant %+v", got, ok, want)
	}
	for _, outcome := range []string{AutomationSucceeded, AutomationSkipped, AutomationMissed} {
		run.Outcome = outcome
		if _, ok := AutomationAlert(run); ok {
			t.Errorf("outcome %s gave an alert", outcome)
		}
	}
}

func TestAddAlertKeepsTheNewestAndDropsRepeats(t *testing.T) {
	var list []Alert
	for i := range MaxAlerts + 3 {
		list = AddAlert(list, Alert{ID: fmt.Sprint(i)})
	}
	if len(list) != MaxAlerts || list[0].ID != "3" || list[len(list)-1].ID != fmt.Sprint(MaxAlerts+2) {
		t.Fatalf("list = %v", list)
	}
	again := AddAlert(list, Alert{ID: "5"})
	if len(again) != MaxAlerts || again[len(again)-1].ID != fmt.Sprint(MaxAlerts+2) {
		t.Errorf("a repeat changed the list: %v", again)
	}
}
