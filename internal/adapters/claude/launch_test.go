package claude_test

import (
	"reflect"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/claude"
	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
)

func TestLaunchRunsClaudeWithTheModelAndEffortInTheSessionDir(t *testing.T) {
	var a app.HarnessAdapter = claude.Adapter{}
	if a.Harness() != domain.HarnessClaude {
		t.Fatalf("harness %q", a.Harness())
	}
	got := a.Launch(app.LaunchRequest{Name: "api-42", Dir: "/home/dev/api", Model: "sonnet", Effort: "high"})
	want := app.PaneSpec{Name: "api-42", Dir: "/home/dev/api", Command: []string{"claude", "--model", "sonnet", "--effort", "high"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestLaunchLeavesDefaultsToClaude(t *testing.T) {
	got := claude.Adapter{Binary: "/opt/claude"}.Launch(app.LaunchRequest{Dir: "/w"})
	if !reflect.DeepEqual(got.Command, []string{"/opt/claude"}) {
		t.Fatalf("command %v", got.Command)
	}
}

func TestLaunchResumesTheClaudeSessionByID(t *testing.T) {
	got := claude.Adapter{}.Launch(app.LaunchRequest{Dir: "/w", Model: "opus", Effort: "high", Resume: "4c98"})
	want := []string{"claude", "--resume", "4c98", "--model", "opus", "--effort", "high"}
	if !reflect.DeepEqual(got.Command, want) {
		t.Fatalf("command %v, want %v", got.Command, want)
	}
}

func TestLaunchAppendsTheSystemPromptBeforeTheFirstPrompt(t *testing.T) {
	got := claude.Adapter{}.Launch(app.LaunchRequest{Dir: "/w", Model: "opus", SystemPrompt: "You are helper.\nBe brief.", Prompt: "hi"})
	want := []string{"claude", "--model", "opus", "--append-system-prompt", "You are helper.\nBe brief.", "--", "hi"}
	if !reflect.DeepEqual(got.Command, want) {
		t.Fatalf("command %v, want %v", got.Command, want)
	}
}

func TestLaunchPinsTheSessionIDAndSaysWhereClaudeWritesTheTranscript(t *testing.T) {
	a := claude.Adapter{ConfigDir: "/home/dev/.claude"}
	got := a.Launch(app.LaunchRequest{Dir: "/home/dev/.crew/worktrees/web_app/ux", Model: "opus", SessionID: "5f0c1d2e-0000-4000-8000-000000000001", Prompt: "hi"})
	want := []string{"claude", "--session-id", "5f0c1d2e-0000-4000-8000-000000000001", "--model", "opus", "--", "hi"}
	if !reflect.DeepEqual(got.Command, want) {
		t.Fatalf("command %v, want %v", got.Command, want)
	}
	if got.Transcript != "/home/dev/.claude/projects/-home-dev--crew-worktrees-web-app-ux/5f0c1d2e-0000-4000-8000-000000000001.jsonl" {
		t.Fatalf("transcript %q", got.Transcript)
	}
}

func TestLaunchOfAResumeKeepsTheResumedIDAndSaysNoTranscript(t *testing.T) {
	got := claude.Adapter{ConfigDir: "/c"}.Launch(app.LaunchRequest{Dir: "/w", Resume: "4c98", SessionID: "5f0c"})
	if !reflect.DeepEqual(got.Command, []string{"claude", "--resume", "4c98"}) || got.Transcript != "" {
		t.Fatalf("spec %+v", got)
	}
}

func TestLaunchWithNoConfigDirPinsNoSessionID(t *testing.T) {
	got := claude.Adapter{}.Launch(app.LaunchRequest{Dir: "/w", SessionID: "5f0c"})
	if !reflect.DeepEqual(got.Command, []string{"claude"}) || got.Transcript != "" {
		t.Fatalf("spec %+v", got)
	}
}
