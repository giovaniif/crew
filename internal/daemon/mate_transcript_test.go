package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/claude"
	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestMateAppThreadShowsTheChatWhenNoClaudeHookArrives(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(home, "config.toml")
	if err := os.WriteFile(config, []byte(localMates), 0o600); err != nil {
		t.Fatal(err)
	}
	store := &memStore{}
	store.snap.Workspaces = append(store.snap.Workspaces, singleWS)
	host := &fakeHost{}
	files := newMemTranscripts()
	tr := app.Transcripts{Files: files, Parsers: map[domain.Harness]func() app.TranscriptParser{
		domain.HarnessClaude: func() app.TranscriptParser { return &claude.TranscriptParser{} },
	}}
	_, sock := start(t, store,
		daemon.WithHarnesses(host, claude.Adapter{ConfigDir: "/h/.claude"}),
		daemon.WithSessions(&fakeWorktrees{}, nil, "/h/.crew/worktrees"),
		daemon.WithFirstPromptGrace(time.Hour),
		daemon.WithConfig(config),
		daemon.WithTranscripts(tr, files),
	)
	c := dial(t, sock)
	var s domain.Session
	if err := c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "Do the first check."}, &s); err != nil {
		t.Fatal(err)
	}
	host.mu.Lock()
	cmd := slices.Clone(host.specs[0].Command)
	host.mu.Unlock()
	i := slices.Index(cmd, "--session-id")
	if i < 0 {
		t.Fatalf("command %v", cmd)
	}
	path := filepath.Join("/h/.claude/projects", "-h--crew-worktrees-api-"+filepath.Base(s.Dir), cmd[i+1]+".jsonl")
	if s.Dir != "/h/.crew/worktrees/api/"+filepath.Base(s.Dir) {
		t.Fatalf("dir %q", s.Dir)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w, err := c.WatchTranscript(ctx, s.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	files.write(path, userLine("u1", "Do the first check.")+assistantLine("a1", "Starting the check."))
	got := msgIDs(w.Messages)
	for len(got) < 2 {
		got = append(got, msgIDs(nextEvent(t, w.Events).Messages)...)
	}
	if !reflect.DeepEqual(got, []string{"u1", "a1"}) {
		t.Fatalf("watched %v", got)
	}
	page, err := c.TranscriptPage(context.Background(), s.ID, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(msgIDs(page.Messages), []string{"u1", "a1"}) {
		t.Fatalf("page %v", msgIDs(page.Messages))
	}
}
