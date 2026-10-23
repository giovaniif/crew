package domain

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

const (
	AlertPRChecksFailed   = "pr_checks_failed"
	AlertAutomationFailed = "automation_failed"
	MaxAlerts             = 20
)

type Alert struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`
	Title   string    `json:"title"`
	Body    string    `json:"body"`
	Session string    `json:"session,omitempty"`
	At      time.Time `json:"at"`
}

func PRChecksAlert(old *Worktree, wt Worktree, at time.Time) (Alert, bool) {
	pr := wt.PR
	if pr == nil || wt.SessionID == "" || pr.Checks != CheckFailing {
		return Alert{}, false
	}
	if old != nil && old.PR != nil && old.PR.Number == pr.Number && old.PR.Checks == CheckFailing {
		return Alert{}, false
	}
	body := pr.Title
	var names []string
	for _, f := range pr.Failing {
		names = append(names, f.Name)
	}
	if len(names) > 0 {
		body += " · " + strings.Join(names, ", ")
	}
	return Alert{
		ID:    AlertPRChecksFailed + ":" + pr.URL + "@" + at.UTC().Format(time.RFC3339Nano),
		Kind:  AlertPRChecksFailed,
		Title: fmt.Sprintf("PR #%d checks failed", pr.Number), Body: body, Session: wt.SessionID, At: at,
	}, true
}

func AutomationAlert(run AutomationRun) (Alert, bool) {
	if run.Outcome != AutomationFailed {
		return Alert{}, false
	}
	return Alert{
		ID: AlertAutomationFailed + ":" + run.ID, Kind: AlertAutomationFailed,
		Title: "Automation " + run.Automation + " failed", Body: run.Reason, Session: run.SessionID, At: run.End,
	}, true
}

func AddAlert(list []Alert, a Alert) []Alert {
	if slices.ContainsFunc(list, func(x Alert) bool { return x.ID == a.ID }) {
		return list
	}
	out := append(slices.Clone(list), a)
	if len(out) > MaxAlerts {
		out = out[len(out)-MaxAlerts:]
	}
	return out
}
