package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func upWithEnvFakes(t *testing.T) (*env, *fakeSys, string) {
	t.Helper()
	e, fs := testEnv(t)
	isoReady(fs)
	got, code := runJSON(t, e, "iso", "up", "--env-fakes")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	return e, fs, got["home"].(string)
}

func TestIsoUpEnvFakesPutsEnvDumpingHarnessesFirstOnPath(t *testing.T) {
	e, fs, home := upWithEnvFakes(t)
	_ = e
	var daemon cmd
	for _, c := range fs.calls {
		if len(c.cmd.args) > 1 && c.cmd.args[0] == "daemon" && c.cmd.args[1] == "start" {
			daemon = c.cmd
		}
	}
	fakes := filepath.Join(home, "fakes")
	if !strings.HasPrefix(envOf(daemon)["PATH"], fakes+":") {
		t.Errorf("PATH %q does not start with %s", envOf(daemon)["PATH"], fakes)
	}
	for _, h := range []string{"claude", "codex", "omp"} {
		c := exec.Command(filepath.Join(fakes, h), "--resume", "TEST-arg")
		c.Env = []string{"CREW_HOME=" + home, "PATH=/usr/bin:/bin", "TEST_VAR=TEST-value"}
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", h, err, out)
		}
		matches, _ := filepath.Glob(filepath.Join(home, "dumps", h+".*.env"))
		if len(matches) != 1 {
			t.Fatalf("%s dumps %v", h, matches)
		}
		b, _ := os.ReadFile(matches[0])
		if !strings.Contains(string(b), "TEST_VAR=TEST-value\n") || !strings.Contains(string(b), "CREW_ARGV=--resume TEST-arg\n") {
			t.Errorf("%s dump %q", h, b)
		}
	}
}

func TestIsoUpWithoutEnvFakesKeepsTheE2EFakesFirst(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	runJSON(t, e, "iso", "up")
	for _, c := range fs.calls {
		if len(c.cmd.args) > 1 && c.cmd.args[0] == "daemon" && strings.Contains(envOf(c.cmd)["PATH"], "/fakes:") {
			t.Errorf("PATH %q has the env fakes", envOf(c.cmd)["PATH"])
		}
	}
}

func TestIsoUpSeedsTheTestPersonalHomeFiles(t *testing.T) {
	_, _, home := upWithEnvFakes(t)
	for _, f := range []string{".gitconfig", ".claude.json", ".claude/settings.json", ".codex/config.toml", ".omp/agent/settings.json", ".config/gh/hosts.yml", ".ssh/config"} {
		b, err := os.ReadFile(filepath.Join(home, "home", f))
		if err != nil || !strings.Contains(string(b), "TEST") {
			t.Errorf("%s: %q %v", f, b, err)
		}
	}
}

func TestIsoCrewStdinFeedsTheCommand(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	runJSON(t, e, "iso", "up")
	var stdin string
	fs.handlers["crew env"] = func(c cmd) (string, string, int) {
		stdin = c.stdin
		return "", "", 0
	}
	mustOK(t, e, "iso", "crew", "--stdin", "sk-ant-oat01-TEST", "--", "env", "set", "test-bot", "X")
	if stdin != "sk-ant-oat01-TEST" {
		t.Errorf("stdin %q", stdin)
	}
}

func writeDump(t *testing.T, home, name, body string) {
	t.Helper()
	d := filepath.Join(home, "dumps")
	if err := os.MkdirAll(d, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestIsoDumpChecksTheNewestDumpOfAHarness(t *testing.T) {
	e, _, home := upWithEnvFakes(t)
	writeDump(t, home, "claude.1.env", "CLAUDE_CONFIG_DIR="+home+"/envs/test-bot/claude\nTOKEN=sk-ant-oat01-TEST\nCREW_ARGV=x\n")
	mustOK(t, e, "iso", "dump", "claude", "--has", "CLAUDE_CONFIG_DIR={home}/envs/test-bot/claude", "--set", "TOKEN", "--unset", "SSH_AUTH_SOCK")
	got, code := runJSON(t, e, "iso", "dump", "claude", "--has", "TOKEN=other", "--unset", "TOKEN", "--set", "GH_TOKEN")
	p := problemText(got)
	if code != 1 || !strings.Contains(p, "TOKEN") || !strings.Contains(p, "GH_TOKEN") {
		t.Errorf("exit %d: %s", code, p)
	}
	if strings.Contains(p, "sk-ant-oat01-TEST") {
		t.Errorf("a value is in the problems: %s", p)
	}
}

func TestIsoDumpClearRemovesTheDumpsAndAMissingDumpFails(t *testing.T) {
	e, _, home := upWithEnvFakes(t)
	writeDump(t, home, "codex.1.env", "A=1\n")
	mustOK(t, e, "iso", "dump", "--clear")
	got, code := runJSON(t, e, "iso", "dump", "codex", "--wait", "0")
	if code != 1 || !strings.Contains(problemText(got), "no dump") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}

func TestIsoDumpSameComparesWithASavedDumpExceptIgnoredVars(t *testing.T) {
	e, _, home := upWithEnvFakes(t)
	writeDump(t, home, "claude.1.env", "A=1\nTMUX_PANE=%1\n")
	mustOK(t, e, "iso", "dump", "claude", "--save", "plain")
	mustOK(t, e, "iso", "dump", "--clear")
	writeDump(t, home, "claude.2.env", "A=1\nTMUX_PANE=%2\n")
	mustOK(t, e, "iso", "dump", "claude", "--same", "plain", "--ignore", "TMUX_PANE")
	writeDump(t, home, "claude.3.env", "A=2\nB=3\nTMUX_PANE=%2\n")
	mustOK(t, e, "iso", "dump", "--clear")
	writeDump(t, home, "claude.3.env", "A=2\nB=3\nTMUX_PANE=%2\n")
	got, code := runJSON(t, e, "iso", "dump", "claude", "--same", "plain", "--ignore", "TMUX_PANE")
	p := problemText(got)
	if code != 1 || !strings.Contains(p, "A") || !strings.Contains(p, "B") {
		t.Errorf("exit %d: %s", code, p)
	}
}

func TestIsoHomesumDetectsAChangeInThePersonalHome(t *testing.T) {
	e, _, home := upWithEnvFakes(t)
	mustOK(t, e, "iso", "homesum", "--save", "before")
	mustOK(t, e, "iso", "homesum", "--check", "before")
	if err := os.WriteFile(filepath.Join(home, "home", ".claude", "TEST-new"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, code := runJSON(t, e, "iso", "homesum", "--check", "before")
	if code != 1 || !strings.Contains(problemText(got), ".claude/TEST-new") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}

func TestIsoLeaksFindsATextInPsLogsAndServeAnswers(t *testing.T) {
	e, fs, home := upWithEnvFakes(t)
	fs.handlers["ps"] = func(cmd) (string, string, int) { return "sh claude\n", "", 0 }
	var auth string
	fs.handlers["curl"] = func(c cmd) (string, string, int) {
		auth = strings.Join(c.args, " ")
		return `{"envs":[{"name":"test-bot"}]}`, "", 0
	}
	mustOK(t, e, "iso", "leaks", "sk-ant-oat01-TEST", "--api", "/api/v1/envs")
	if !strings.Contains(auth, "Authorization: Bearer tok-1") || !strings.Contains(auth, "/api/v1/envs") {
		t.Errorf("curl %q", auth)
	}
	if err := os.WriteFile(filepath.Join(home, "daemon.log"), []byte("x sk-ant-oat01-TEST y"), 0o600); err != nil {
		t.Fatal(err)
	}
	fs.handlers["ps"] = func(cmd) (string, string, int) { return "sh sk-ant-oat01-TEST\n", "", 0 }
	fs.handlers["curl"] = func(cmd) (string, string, int) { return `"sk-ant-oat01-TEST"`, "", 0 }
	got, code := runJSON(t, e, "iso", "leaks", "sk-ant-oat01-TEST", "--api", "/api/v1/envs")
	p := problemText(got)
	if code != 1 || !strings.Contains(p, "ps") || !strings.Contains(p, "daemon.log") || !strings.Contains(p, "/api/v1/envs") {
		t.Errorf("exit %d: %s", code, p)
	}
}

func TestIsoPanesChecksThePaneStartCommands(t *testing.T) {
	e, fs, _ := upWithEnvFakes(t)
	fs.handlers["tmux"] = func(cmd) (string, string, int) {
		return "/tmp/crew-iso-1/bin/crew env exec test-bot -- claude\n", "", 0
	}
	mustOK(t, e, "iso", "panes", "--expect", "env exec test-bot -- claude")
	got, code := runJSON(t, e, "iso", "panes", "--expect", "env exec test-bot -- codex")
	if code != 1 || !strings.Contains(problemText(got), "codex") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}
