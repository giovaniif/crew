package daemon_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const localMates = `
[[mate]]
name = "helper"
prompt = "You help with the api."
agent = "claude"
model = "opus"
effort = "high"
repos = ["api"]
avatar = "robot-2"
color = "#3a7bd5"
`

func localRig(t *testing.T) (mateRig, string) {
	t.Helper()
	r := startMateRigWith(t, &memStore{}, localMates)
	var mem rpc.MateMemory
	if err := r.c.Call(context.Background(), rpc.MethodMateMemory, rpc.MateNameParams{Name: "helper"}, &mem); err != nil {
		t.Fatal(err)
	}
	return r, mem.Path
}

func TestMateWithNoSlackTokensIsReady(t *testing.T) {
	r, _ := localRig(t)
	waitFor(t, func() bool {
		var list rpc.MateList
		if err := r.c.Call(context.Background(), rpc.MethodMateList, nil, &list); err != nil {
			return false
		}
		return len(list.States) == 1 && list.States[0].State == domain.MateReady
	})
}

func TestMateListKeepsTheAvatarAndTheColor(t *testing.T) {
	r, _ := localRig(t)
	var list rpc.MateList
	if err := r.c.Call(context.Background(), rpc.MethodMateList, nil, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Mates) != 1 || list.Mates[0].Avatar != "robot-2" || list.Mates[0].Color != "#3a7bd5" {
		t.Fatalf("mates %+v, problems %v", list.Mates, list.Problems)
	}
}

func TestMateNewStartsASessionWithTheMatePromptAndMemoryAsTheSystemPrompt(t *testing.T) {
	r, memory := localRig(t)
	if err := r.c.Call(context.Background(), rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "helper", Text: "- The owner likes short PRs.\n"}, nil); err != nil {
		t.Fatal(err)
	}
	var s domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "fix the login bug"}, &s); err != nil {
		t.Fatal(err)
	}
	if s.Mate == nil || s.Mate.Name != "helper" || !s.Mate.Local {
		t.Fatalf("session mate %+v", s.Mate)
	}
	if s.Model != "opus" || s.Effort != "high" {
		t.Fatalf("model %q effort %q", s.Model, s.Effort)
	}
	r.host.mu.Lock()
	specs := slices.Clone(r.host.specs)
	r.host.mu.Unlock()
	if len(specs) != 1 {
		t.Fatalf("specs %+v", specs)
	}
	cmd := specs[0].Command
	i := slices.Index(cmd, "--append-system-prompt")
	if i < 0 || i+1 >= len(cmd) {
		t.Fatalf("command %v", cmd)
	}
	system := cmd[i+1]
	for _, want := range []string{"You help with the api.", "- The owner likes short PRs.", memory} {
		if !strings.Contains(system, want) {
			t.Errorf("system prompt has no %q:\n%s", want, system)
		}
	}
	waitFor(t, func() bool {
		for _, m := range r.mateSessions(t) {
			if m.ID == s.ID && m.Mate.Name == "helper" {
				return true
			}
		}
		return false
	})
}

func TestMateNewOfAnUnknownMateIsNotFound(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "nobody"}, nil)
	var rerr *rpc.Error
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeNotFound {
		t.Fatalf("err %v", err)
	}
}

func TestMateNewInARepoThatIsNotRegisteredFails(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Repo: "billing"}, nil)
	if err == nil || !strings.Contains(err.Error(), "billing") {
		t.Fatalf("err %v", err)
	}
}

func TestMateMemoryIsEmptyAtFirstAndKeepsWhatTheOwnerSets(t *testing.T) {
	r, path := localRig(t)
	if filepath.Base(path) != "memory.md" || filepath.Base(filepath.Dir(path)) != "helper" || filepath.Base(filepath.Dir(filepath.Dir(path))) != "mates" {
		t.Fatalf("path %q", path)
	}
	var mem rpc.MateMemory
	if err := r.c.Call(context.Background(), rpc.MethodMateMemory, rpc.MateNameParams{Name: "helper"}, &mem); err != nil {
		t.Fatal(err)
	}
	if mem.Text != "" || mem.Path != path || mem.Limit != domain.MateMemoryLimit {
		t.Fatalf("memory %+v", mem)
	}
	if err := r.c.Call(context.Background(), rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "helper", Text: "note"}, nil); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != "note" {
		t.Fatalf("file %q %v", b, err)
	}
	if err := r.c.Call(context.Background(), rpc.MethodMateMemory, rpc.MateNameParams{Name: "helper"}, &mem); err != nil || mem.Text != "note" {
		t.Fatalf("memory %+v %v", mem, err)
	}
	if err := r.c.Call(context.Background(), rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "helper", Text: ""}, nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); len(b) != 0 {
		t.Fatalf("a clear leaves %q", b)
	}
}

func TestMateSetMemoryOverTheLimitIsRefused(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "helper", Text: strings.Repeat("x", domain.MateMemoryLimit+1)}, nil)
	if err == nil || !strings.Contains(err.Error(), "8192") {
		t.Fatalf("err %v", err)
	}
}

func TestMateMemoryOfAnUnknownMateIsNotFound(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: "nobody", Text: "x"}, nil)
	var rerr *rpc.Error
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeNotFound {
		t.Fatalf("err %v", err)
	}
}

func TestLocalMateSessionRunsADangerousActionWithNoApproval(t *testing.T) {
	_, c, _ := mateOn(t, &domain.MateSeat{Name: "ada", Local: true})
	if reply := preToolUse(t, c, "git push", true); len(reply.Output) != 0 {
		t.Fatalf("reply %s", reply.Output)
	}
	if got := pendingApprovals(t, c); len(got) != 0 {
		t.Fatalf("approvals %+v", got)
	}
}
