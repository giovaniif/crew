package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsoUpGivesTheCrewATestSSHAgentSocket(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	got, _ := runJSON(t, e, "iso", "up")
	home := got["home"].(string)
	for _, c := range fs.calls {
		if len(c.cmd.args) > 1 && c.cmd.args[0] == "daemon" && c.cmd.args[1] == "start" {
			if sock := envOf(c.cmd)["SSH_AUTH_SOCK"]; !strings.HasPrefix(sock, home+"/") {
				t.Errorf("SSH_AUTH_SOCK %q is not in the iso home", sock)
			}
		}
	}
}

func TestIsoFileChecksAFileInTheIsoHome(t *testing.T) {
	e, _, home := upWithEnvFakes(t)
	if err := os.MkdirAll(filepath.Join(home, "envs", "test-bot", "claude"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "envs", "test-bot", "claude", "settings.json"), []byte(`{"hooks":"crew hook"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	mustOK(t, e, "iso", "file", "{home}/envs/test-bot/claude/settings.json", "--expect", "crew hook")
	got, code := runJSON(t, e, "iso", "file", "{home}/envs/test-bot/claude/settings.json", "--expect", "TEST-nothing")
	if code != 1 || !strings.Contains(problemText(got), "TEST-nothing") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	got, code = runJSON(t, e, "iso", "file", "{home}/envs/test-bot/codex/hooks.json")
	if code != 1 || !strings.Contains(problemText(got), "hooks.json") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	got, code = runJSON(t, e, "iso", "file", "/etc/passwd")
	if code != 2 {
		t.Errorf("a path out of the iso home: exit %d: %s", code, problemText(got))
	}
}

func TestIsoPanesStartMatchesTheStartOfAPaneCommandAndKillEndsIt(t *testing.T) {
	e, fs, _ := upWithEnvFakes(t)
	var killed []string
	fs.handlers["tmux"] = func(c cmd) (string, string, int) {
		if len(c.args) > 2 && c.args[2] == "kill-pane" {
			killed = append(killed, c.args[len(c.args)-1])
			return "", "", 0
		}
		return "%1 claude --append-system-prompt \"TEST local\"\n%2 /x/crew env exec test-bot -- claude --append-system-prompt \"TEST custom\"\n", "", 0
	}
	got := mustOK(t, e, "iso", "panes", "--start", "claude --append-system-prompt \"TEST local")
	if panes := got["panes"].([]any); len(panes) != 2 || strings.HasPrefix(panes[0].(string), "%") {
		t.Errorf("panes %v", panes)
	}
	got, code := runJSON(t, e, "iso", "panes", "--start", "claude --append-system-prompt \"TEST custom")
	if code != 1 {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	mustOK(t, e, "iso", "panes", "--kill", "TEST custom")
	if len(killed) != 1 || killed[0] != "%2" {
		t.Errorf("killed %v", killed)
	}
	_, code = runJSON(t, e, "iso", "panes", "--kill", "TEST-nothing")
	if code != 1 {
		t.Errorf("kill of no pane: exit %d", code)
	}
}

func TestIsoAPICallsServeWithTheDeviceToken(t *testing.T) {
	e, fs, _ := upWithEnvFakes(t)
	var args string
	fs.handlers["curl"] = func(c cmd) (string, string, int) {
		args = strings.Join(c.args, " ")
		return `{"id":"s1"}` + "\n200", "", 0
	}
	got := mustOK(t, e, "iso", "api", "POST", "/api/v1/sessions/s1/resume", "--expect", "s1")
	for _, want := range []string{"-X POST", "Authorization: Bearer tok-1", "/api/v1/sessions/s1/resume"} {
		if !strings.Contains(args, want) {
			t.Errorf("curl %q has no %q", args, want)
		}
	}
	if got["status"] != float64(200) || got["body"] != `{"id":"s1"}` {
		t.Errorf("status %v body %v", got["status"], got["body"])
	}
	fs.handlers["curl"] = func(c cmd) (string, string, int) { return `{"error":{"code":"failed"}}` + "\n409", "", 0 }
	got, code := runJSON(t, e, "iso", "api", "DELETE", "/api/v1/envs/test-bot")
	if code != 1 || !strings.Contains(problemText(got), "409") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	mustOK(t, e, "iso", "api", "DELETE", "/api/v1/envs/test-bot", "--status", "409", "--expect", "failed")
}
