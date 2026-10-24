package daemon_test

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const envLaunchMates = `
[[env]]
name = "test-bot"
kind = "custom"

[[mate]]
name = "claude-bot"
prompt = "You help."
agent = "claude"
repos = ["api"]
env = "test-bot"

[[mate]]
name = "codex-bot"
prompt = "You help."
agent = "codex"
repos = ["api"]
env = "test-bot"

[[mate]]
name = "pi-bot"
prompt = "You help."
agent = "omp"
repos = ["api"]
env = "test-bot"

[[mate]]
name = "plain"
prompt = "You help."
agent = "claude"
repos = ["api"]
`

var envPrefix = []string{"/opt/crew", "identity", "exec", "test-bot", "--harness"}

func envWrapped(cmd []string, harness string) bool {
	n := len(envPrefix)
	return len(cmd) > n+2 && slices.Equal(cmd[:n], envPrefix) && cmd[n] == harness && cmd[n+1] == "--" && cmd[n+2] == harness
}

func lastSpec(r mateRig) []string {
	r.host.mu.Lock()
	defer r.host.mu.Unlock()
	return slices.Clone(r.host.specs[len(r.host.specs)-1].Command)
}

func startAndResumeMate(t *testing.T, r mateRig, name, harness string) (start, resume []string) {
	t.Helper()
	ctx := context.Background()
	var s domain.Session
	if err := r.c.Call(ctx, rpc.MethodMateNew, rpc.MateNewParams{Name: name, Prompt: "TEST prompt"}, &s); err != nil {
		t.Fatal(err)
	}
	start = lastSpec(r)
	event := "SessionStart"
	if harness == "omp" {
		event = "session_start"
	}
	hook := rpc.Hook{Harness: harness, Event: event, Pane: s.Pane, At: time.Now(), Payload: []byte(`{"session_id":"r-1"}`)}
	if err := r.c.Call(ctx, rpc.MethodHook, hook, nil); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		var got domain.Session
		_ = r.c.Call(ctx, rpc.MethodEndSession, rpc.SessionRef{ID: s.ID}, &got)
		err := r.c.Call(ctx, rpc.MethodResumeSession, rpc.SessionRef{ID: s.ID}, nil)
		return err == nil
	})
	return start, lastSpec(r)
}

func TestMateWithAnEnvStartsAndResumesThroughCrewEnvExec(t *testing.T) {

	for _, tc := range []struct{ mate, harness string }{{"claude-bot", "claude"}, {"codex-bot", "codex"}, {"pi-bot", "omp"}} {
		r := startMateRigWith(t, &memStore{}, envLaunchMates, daemon.WithEnvLauncher("/opt/crew"))
		start, resume := startAndResumeMate(t, r, tc.mate, tc.harness)
		for what, cmd := range map[string][]string{"start": start, "resume": resume} {
			if !envWrapped(cmd, tc.harness) {
				t.Errorf("%s %s: command %q", tc.mate, what, cmd)
			}
		}
		if !slices.Contains(resume, "r-1") {
			t.Errorf("%s resume lost the id: %q", tc.mate, resume)
		}
	}
}

func TestPiMateGetsTheMateSystemPromptOnStartAndResume(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, envLaunchMates, daemon.WithEnvLauncher("/opt/crew"))
	start, resume := startAndResumeMate(t, r, "pi-bot", "omp")
	for what, cmd := range map[string][]string{"start": start, "resume": resume} {
		i := slices.Index(cmd, "--append-system-prompt")
		if i < 0 || i+1 >= len(cmd) || !strings.Contains(cmd[i+1], "You help.") {
			t.Errorf("%s: command %q", what, cmd)
		}
	}
}

func TestMateOnYoursWithNoExtraVariablesKeepsTodaysCommand(t *testing.T) {
	config := envLaunchMates + "\n[[mate]]\nname = \"mine\"\nprompt = \"You help.\"\nagent = \"claude\"\nrepos = [\"api\"]\nenvironment = { machine_id = \"m-test\", identity_id = \"yours\" }\n"
	r := startMateRigWith(t, &memStore{}, config, daemon.WithEnvLauncher("/opt/crew"))
	start, resume := startAndResumeMate(t, r, "mine", "claude")
	if start[0] != "claude" || resume[0] != "claude" {
		t.Fatalf("start %q resume %q", start, resume)
	}
}

func TestMateWithNoEnvKeepsTodaysCommand(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, envLaunchMates, daemon.WithEnvLauncher("/opt/crew"))
	start, resume := startAndResumeMate(t, r, "plain", "claude")
	if start[0] != "claude" || resume[0] != "claude" {
		t.Fatalf("start %q resume %q", start, resume)
	}
}

func TestSlackMateWithAnEnvStartsThroughCrewEnvExec(t *testing.T) {
	config := strings.Replace(threadMates, "owner = \"U0OWNER01\"\n", "owner = \"U0OWNER01\"\nenv = \"test-bot\"\n", 1) + "\n[[env]]\nname = \"test-bot\"\nkind = \"custom\"\n"
	r := startMateRigWith(t, &memStore{}, config, daemon.WithEnvLauncher("/opt/crew"))
	m := r.connect(t, "helper")
	r.hub.send(m, mention(mateGuest, "<@U0BOT0001> please look", "1700.0001"))
	waitFor(t, func() bool { return len(r.mateSessions(t)) == 1 })
	cmd := lastSpec(r)
	if !envWrapped(cmd, "claude") {
		t.Fatalf("command %q", cmd)
	}
}

func TestMateEnvLaunchPutsNoSecretInThePaneEnv(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, envLaunchMates, daemon.WithEnvLauncher("/opt/crew"))
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "claude-bot", Prompt: "TEST prompt"}, nil); err != nil {
		t.Fatal(err)
	}
	r.host.mu.Lock()
	env := r.host.specs[len(r.host.specs)-1].Env
	r.host.mu.Unlock()
	for k := range env {
		if k != "CREW_SESSION" && k != "CREW_HOME" {
			t.Errorf("pane env has %s", k)
		}
	}
}
