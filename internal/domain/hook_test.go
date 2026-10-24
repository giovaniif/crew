package domain

import "testing"

func TestPaneIsOnTheCrewServerOnlyWhenTheTmuxSocketIsCrews(t *testing.T) {
	cases := []struct {
		tmux, socket string
		want         bool
	}{
		{"/tmp/tmux-1000/crew,1337712,0", "crew", true},
		{"/tmp/tmux-1000/default,773337,0", "crew", false},
		{"/tmp/tmux-1000/crew-dev,5,0", "crew", false},
		{"/private/tmp/tmux-501/crew-test,5,0", "crew-test", true},
		{"/tmp/tmux-1000/crew,5,0", "/tmp/tmux-1000/crew", true},
		{"/tmp/tmux-1000/other,5,0", "/tmp/tmux-1000/crew", false},
		{"", "crew", true},
		{"/tmp/tmux-1000/default,1,0", "", true},
	}
	for _, c := range cases {
		if got := PaneOnServer(c.tmux, c.socket); got != c.want {
			t.Errorf("PaneOnServer(%q, %q) = %v, want %v", c.tmux, c.socket, got, c.want)
		}
	}
}

func TestHookEventNamesMapToHarnessEvents(t *testing.T) {
	cases := []struct {
		harness Harness
		name    string
		want    HarnessEventKind
		ok      bool
	}{
		{HarnessClaude, "SessionStart", EventSessionStart, true},
		{HarnessClaude, "UserPromptSubmit", EventUserPromptSubmit, true},
		{HarnessClaude, "PreToolUse", EventPreToolUse, true},
		{HarnessClaude, "PostToolUse", EventPostToolUse, true},
		{HarnessClaude, "PermissionRequest", EventPermissionRequest, true},
		{HarnessClaude, "Notification", EventWaitingForInput, true},
		{HarnessClaude, "Stop", EventStop, true},
		{HarnessClaude, "SessionEnd", EventSessionEnd, true},
		{HarnessClaude, "SubagentStart", EventSubagentStart, true},
		{HarnessClaude, "SubagentStop", EventSubagentStop, true},
		{HarnessClaude, "StatusLine", "", false},
		{HarnessCodex, "SessionStart", EventSessionStart, true},
		{HarnessCodex, "UserPromptSubmit", EventUserPromptSubmit, true},
		{HarnessCodex, "PreToolUse", EventPreToolUse, true},
		{HarnessCodex, "PostToolUse", EventPostToolUse, true},
		{HarnessCodex, "Stop", EventStop, true},
		{HarnessCodex, "PermissionRequest", EventPermissionRequest, true},
		{HarnessCodex, "Interrupt", EventStop, true},
		{HarnessCodex, "SessionEnd", EventSessionEnd, true},
		{HarnessCodex, "SubagentStart", "", false},
		{HarnessCodex, "SubagentStop", "", false},
		{HarnessCodex, "PreCompact", "", false},
		{HarnessCodex, "Notification", "", false},
		{HarnessOmp, "session_start", EventSessionStart, true},
		{HarnessOmp, "agent_start", EventUserPromptSubmit, true},
		{HarnessOmp, "tool_call", EventPreToolUse, true},
		{HarnessOmp, "tool_result", EventPostToolUse, true},
		{HarnessOmp, "tool_approval_requested", EventPermissionRequest, true},
		{HarnessOmp, "tool_approval_resolved", EventWaitingForInput, true},
		{HarnessOmp, "session_stop", EventStop, true},
		{HarnessOmp, "session_shutdown", EventSessionEnd, true},
		{HarnessOmp, "turn_end", "", false},
		{HarnessOmp, "agent_end", EventStop, true},
		{HarnessOmp, "session_switch", "", false},
		{HarnessOmp, "Stop", "", false},
		{"other", "Stop", "", false},
	}
	for _, c := range cases {
		got, ok := HookEvent(c.harness, c.name)
		if got != c.want || ok != c.ok {
			t.Errorf("HookEvent(%q, %q) = %q, %v; want %q, %v", c.harness, c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestOnlyUserPromptSubmitExpectsAReply(t *testing.T) {
	for _, name := range []string{"SessionStart", "PreToolUse", "PostToolUse", "Stop", "Notification", "PermissionRequest"} {
		if HookWantsReply(name) {
			t.Errorf("%s wants a reply", name)
		}
	}
	if !HookWantsReply("UserPromptSubmit") {
		t.Error("UserPromptSubmit wants no reply")
	}
}

func TestSessionOnPaneFindsOnlyThatPane(t *testing.T) {
	sessions := []Session{{ID: "a", Pane: "%1"}, {ID: "b", Pane: "%2"}}
	if s, ok := SessionOnPane(sessions, "%2"); !ok || s.ID != "b" {
		t.Fatalf("got %+v, %v", s, ok)
	}
	for _, pane := range []string{"%9", ""} {
		if _, ok := SessionOnPane(append(sessions, Session{ID: "c"}), pane); ok {
			t.Fatalf("pane %q matched", pane)
		}
	}
}

func TestClaudeNotificationTypeDecidesPermissionOrWaiting(t *testing.T) {
	cases := []struct {
		notificationType string
		want             HarnessEventKind
		ok               bool
	}{
		{"permission_prompt", EventPermissionRequest, true},
		{"idle_prompt", EventWaitingForInput, true},
		{"elicitation_dialog", EventWaitingForInput, true},
		{"", EventWaitingForInput, true},
		{"auth_success", "", false},
	}
	for _, c := range cases {
		got, ok := ClaudeNotification(c.notificationType)
		if got != c.want || ok != c.ok {
			t.Errorf("ClaudeNotification(%q) = %q, %v; want %q, %v", c.notificationType, got, ok, c.want, c.ok)
		}
	}
}
