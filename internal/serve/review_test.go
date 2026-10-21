package serve_test

import (
	"net/http"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

var reviewWorktree = domain.Worktree{ID: "w1", Repo: "/home/me/api", Path: "/home/me/api-42", Branch: "42-fix", PR: &domain.PullRequest{Number: 42}}

var reviewFile = domain.FileDiff{
	Path: "main.go", Status: domain.FileModified, Added: 1, Deleted: 1, Blob: "b2",
	Hunks: []domain.Hunk{{Header: "@@ -1,2 +1,2 @@", Lines: []domain.DiffLine{
		{Kind: domain.LineContext, Old: 1, New: 1, Text: "package main"},
		{Kind: domain.LineDeleted, Old: 2, Text: "func old() {}"},
		{Kind: domain.LineAdded, New: 2, Text: "func run() int { return 1 }"},
	}}},
}

var reviewDraft = domain.ReviewDraft{
	ID: "d1", Session: "s1", Status: domain.DraftOpen,
	Comments: []domain.ReviewComment{{ID: "c1", Worktree: "/home/me/api-42", Path: "main.go", Start: 2, End: 2, Code: []string{"func run() int { return 1 }"}, Body: "name it start"}},
}

func TestServeReviewOpensTheScopeWithSyntaxSpans(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodReviewOpen] = rpc.Review{
		Scope:     domain.ScopeBranch,
		Worktrees: []domain.WorktreeReview{{Worktree: reviewWorktree, From: "abc123", Files: []domain.FileDiff{reviewFile}}},
		Viewed:    []domain.ViewedMark{{Worktree: "w1", Path: "main.go", Blob: "b2"}},
		Draft:     reviewDraft,
	}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "GET", "/api/v1/sessions/s1/review?scope=branch&worktree=w1", goodToken, "")
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-open.json", body)
	if got := f.paramsOf(rpc.MethodReviewOpen); len(got) != 1 || string(got[0]) != `{"session":"s1","scope":"branch","worktree":"w1"}` {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewOpenWithNoScopeAsksForTheLastScope(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodReviewOpen] = rpc.Review{Scope: domain.ScopeLastTurn}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	if status, body := do(t, ts, "GET", "/api/v1/sessions/s1/review", goodToken, ""); status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	if got := f.paramsOf(rpc.MethodReviewOpen); len(got) != 1 || string(got[0]) != `{"session":"s1","scope":""}` {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewViewedMarksAFile(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/viewed", goodToken, `{"mark":{"Worktree":"w1","Path":"main.go","Blob":"b2"},"viewed":true}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-viewed.json", body)
	if got := f.paramsOf(rpc.MethodReviewViewed); len(got) != 1 || string(got[0]) != `{"mark":{"Worktree":"w1","Path":"main.go","Blob":"b2"},"viewed":true}` {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewViewedNeedsAMark(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/viewed", goodToken, `{"viewed":true}`)
	if status != http.StatusBadRequest || errorCode(t, body) != rpc.CodeBadRequest {
		t.Fatalf("status %d %s", status, body)
	}
	if len(f.paramsOf(rpc.MethodReviewViewed)) != 0 {
		t.Fatal("serve called review.viewed without a mark")
	}
}

func TestServeReviewCommentAddsToTheDraft(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodReviewComment] = reviewDraft
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/comments", goodToken,
		`{"worktree":"w1","path":"main.go","start_line":2,"end_line":2,"code":"func run() int { return 1 }","body":"name it start"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-comment.json", body)
	want := `{"session":"s1","worktree":"w1","path":"main.go","start_line":2,"end_line":2,"code":"func run() int { return 1 }","body":"name it start"}`
	if got := f.paramsOf(rpc.MethodReviewComment); len(got) != 1 || string(got[0]) != want {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewSendQueuesTheDraftWithTheNote(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	sent := reviewDraft
	sent.Status = domain.DraftQueued
	sent.Note = "looks good"
	f.results[rpc.MethodReviewSend] = sent
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/send", goodToken, `{"note":"looks good"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-send.json", body)
	if got := f.paramsOf(rpc.MethodReviewSend); len(got) != 1 || string(got[0]) != `{"session":"s1","note":"looks good"}` {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewHunkStagesOneHunk(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/hunk", goodToken,
		`{"worktree":"w1","file":{"Path":"main.go","Hunks":[{"Header":"@@ -1 +1 @@","Lines":[]}]},"hunk":0,"action":"stage"}`)
	if status != http.StatusOK {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-hunk.json", body)
	got := f.paramsOf(rpc.MethodReviewHunk)
	want := `{"session":"s1","worktree":"w1","file":{"Path":"main.go","OldPath":"","Status":"","Added":0,"Deleted":0,"Binary":false,"Blob":"","Hunks":[{"Header":"@@ -1 +1 @@","Lines":[]}]},"hunk":0,"action":"stage"}`
	if len(got) != 1 || string(got[0]) != want {
		t.Fatalf("params %s", got)
	}
}

func TestServeReviewHunkRefusedByGitGivesTheMessageOfThePatchTool(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.errs[rpc.MethodReviewHunk] = &rpc.Error{Code: rpc.CodeFailed, Message: "error: patch failed: main.go:1"}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/hunk", goodToken, `{"worktree":"w1","file":{"Path":"main.go"},"hunk":0,"action":"revert"}`)
	if status != http.StatusInternalServerError {
		t.Fatalf("status %d %s", status, body)
	}
	golden(t, "review-hunk-refused.json", body)
}

func TestServeReviewHunkNeedsAKnownAction(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/review/hunk", goodToken, `{"worktree":"w1","file":{"Path":"main.go"},"hunk":0,"action":"drop"}`)
	if status != http.StatusBadRequest || errorCode(t, body) != rpc.CodeBadRequest {
		t.Fatalf("status %d %s", status, body)
	}
	if len(f.paramsOf(rpc.MethodReviewHunk)) != 0 {
		t.Fatal("serve called review.hunk with an unknown action")
	}
}
