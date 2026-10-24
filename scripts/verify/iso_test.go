package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestFakeClaudeChatSendsTheSameSessionIDOnEachStartInAWorktree(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "crew")
	log := filepath.Join(dir, "hooks.log")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\ncat >>"+log+"\necho >>"+log+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "chat.sh")
	if err := os.WriteFile(script, []byte(fmt.Sprintf(chatScript, bin)), 0o755); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		c := exec.Command("sh", script)
		c.Dir = dir
		c.Env = append(os.Environ(), "CREW_E2E="+dir)
		c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		_ = c.Run()
	}
	data, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	ids := regexp.MustCompile(`"session_id":"([^"]+)"`).FindAllStringSubmatch(string(data), -1)
	if len(ids) != 2 || ids[0][1] == "" || ids[0][1] != ids[1][1] {
		t.Errorf("session ids %v in %q", ids, data)
	}
	if strings.Count(chatScript, `\"session_id\":\"$sid\"`) != 3 {
		t.Error("not every hook sends the session id")
	}
}

func isoReady(fs *fakeSys) {
	fs.paths["go"] = true
	fs.handlers["crew remote"] = func(cmd) (string, string, int) {
		return "\nScan the code with your phone, or open:\n\n  https://iso.invalid/#pair=K7QW2M4X\n\nCode K7QW2M4X, single use, expires at 3:04PM.\n", "", 0
	}
	fs.http = func(method, url, body string) (int, string, error) {
		if strings.HasSuffix(url, "/api/v1/pair") {
			if !strings.Contains(body, "K7QW2M4X") {
				return 401, `{"error":{"code":"unauthorized"}}`, nil
			}
			return 200, `{"device":{"id":"d1","name":"TEST-verify"},"token":"tok-1"}`, nil
		}
		return 200, `{"api":"v1"}`, nil
	}
}

func envOf(c cmd) map[string]string {
	m := map[string]string{}
	for _, kv := range c.env {
		k, v, _ := strings.Cut(kv, "=")
		m[k] = v
	}
	return m
}

func TestIsoUpStartsAnIsolatedCrewAndPairsADevice(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	fs.vars["HOME"] = "/home/real"
	got, code := runJSON(t, e, "iso", "up")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	home, _ := got["home"].(string)
	if !strings.HasPrefix(home, "/tmp/") {
		t.Errorf("home %q is not under /tmp", home)
	}
	if got["token"] != nil {
		t.Errorf("the token is printed: %v", got)
	}
	if got["web_url"] == "" || got["serve_url"] == "" {
		t.Errorf("no URLs: %v", got)
	}
	if !fs.ran("go build") {
		t.Error("crew was not built")
	}
	var daemon *cmd
	for i, c := range fs.calls {
		if strings.HasSuffix(c.cmd.name, "/crew") && len(c.cmd.args) > 1 && c.cmd.args[0] == "daemon" && c.cmd.args[1] == "start" {
			daemon = &fs.calls[i].cmd
		}
	}
	if daemon == nil {
		t.Fatal("the daemon was not started")
	}
	vars := envOf(*daemon)
	for _, k := range []string{"CREW_HOME", "CREW_TMUX_SOCKET", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CREW_E2E"} {
		if vars[k] == "" {
			t.Errorf("%s not set", k)
		}
		if strings.HasPrefix(vars[k], "/home/real") {
			t.Errorf("%s = %q points at the real home", k, vars[k])
		}
	}
	if vars["CREW_TMUX_SOCKET"] == "crew" {
		t.Error("uses the real crew tmux server")
	}
	if !strings.HasPrefix(vars["PATH"], filepath.Join(e.repo, "test/e2e/testdata/bin")) {
		t.Errorf("PATH %q does not start with the fakes", vars["PATH"])
	}
	for _, k := range []string{"SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"} {
		if v, ok := vars[k]; !ok || v != "" {
			t.Errorf("%s is not blanked", k)
		}
	}
	if len(fs.started) != 2 {
		t.Fatalf("started %d background processes, want serve and vite", len(fs.started))
	}
	st, err := loadIso(e)
	if err != nil {
		t.Fatal(err)
	}
	if st.Token != "tok-1" {
		t.Errorf("token %q not saved", st.Token)
	}
	info, err := os.Stat(isoPath(e))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("state file mode %v, %v", info, err)
	}
}

func TestIsoUpTwiceIsRefused(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	runJSON(t, e, "iso", "up")
	got, code := runJSON(t, e, "iso", "up")
	if code != 1 || !strings.Contains(problemText(got), "already up") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}

func TestIsoSeedNeedsUpAndRunsDebugSeed(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	got, code := runJSON(t, e, "iso", "seed")
	if code != 1 || !strings.Contains(problemText(got), "verify iso up") {
		t.Errorf("seed before up: exit %d: %s", code, problemText(got))
	}
	runJSON(t, e, "iso", "up")
	got, code = runJSON(t, e, "iso", "seed", "--sessions", "4")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	if !fs.ran(filepath.Join(got["home"].(string), "bin/crew") + " debug seed 4") {
		t.Error("crew debug seed 4 did not run")
	}
}

func TestIsoDownStopsEverythingAndRemovesTheHome(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	up, _ := runJSON(t, e, "iso", "up")
	home := up["home"].(string)
	got, code := runJSON(t, e, "iso", "down")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	if len(fs.killed) != 2 {
		t.Errorf("killed %v", fs.killed)
	}
	if !fs.ran("tmux -L") {
		t.Error("the tmux servers were not stopped")
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Errorf("home %s still exists", home)
	}
	if _, err := os.Stat(isoPath(e)); !os.IsNotExist(err) {
		t.Error("state file still exists")
	}
	_, code = runJSON(t, e, "iso", "down")
	if code != 0 {
		t.Errorf("a second down: exit %d", code)
	}
}

func TestIsoCrewRunsTheIsolatedBinaryAndChecksItsOutput(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	runJSON(t, e, "iso", "up")
	fs.handlers["crew pr"] = func(c cmd) (string, string, int) {
		if envOf(c)["CREW_HOME"] == "" {
			t.Error("no isolated env")
		}
		return "PR #40 checks failing\n", "", 0
	}
	got := mustOK(t, e, "iso", "crew", "--expect", "checks failing", "--", "pr", "seed-session-1")
	if !strings.Contains(got["stdout"].(string), "PR #40") {
		t.Errorf("stdout %v", got["stdout"])
	}
	got, code := runJSON(t, e, "iso", "crew", "--expect", "TEST-nothing", "--", "pr", "seed-session-1")
	if code != 1 || !strings.Contains(problemText(got), "TEST-nothing") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	fs.handlers["crew pr"] = func(c cmd) (string, string, int) { return "", "boom", 3 }
	got, code = runJSON(t, e, "iso", "crew", "--", "pr", "x")
	if code != 1 || got["exit"] != float64(3) {
		t.Errorf("exit %d: %v", code, got["exit"])
	}
}

func TestIsoUpFailsCleanlyWhenPairingFails(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	fs.http = func(method, url, body string) (int, string, error) {
		if strings.HasSuffix(url, "/pair") {
			return 401, `{}`, nil
		}
		return 200, `{}`, nil
	}
	got, code := runJSON(t, e, "iso", "up")
	if code != 1 || !strings.Contains(problemText(got), "pair") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	if len(fs.killed) != 2 {
		t.Errorf("did not stop what it started: %v", fs.killed)
	}
}

func TestIsoUpSessionStartsALiveFakeAgentSessionInARealRepo(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	fs.paths["git"] = true
	fs.handlers["crew new"] = func(c cmd) (string, string, int) {
		if envOf(c)["CREW_TMUX_SOCKET"] == "" {
			t.Error("crew new runs without the isolated env")
		}
		return "session s-live1 on pane %3\n", "", 0
	}
	got, code := runJSON(t, e, "iso", "up", "--session")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	home := got["home"].(string)
	repo := filepath.Join(home, "TEST-live")
	if !fs.ran("git -C " + repo + " init") {
		t.Errorf("no git repo made at %s", repo)
	}
	if !fs.ran(filepath.Join(home, "bin/crew") + " new --workspace " + repo) {
		t.Error("crew new did not start a session in the repo")
	}
	steps, err := os.ReadFile(filepath.Join(home, "e2e", "claude.steps"))
	if err != nil || !strings.Contains(string(steps), "chat") {
		t.Errorf("the fake claude does not chat: %q, %v", steps, err)
	}
	if got["session"] != "s-live1" || got["pane"] != "%3" || got["worktree"] != repo {
		t.Errorf("session, pane, worktree = %v, %v, %v", got["session"], got["pane"], got["worktree"])
	}
	st, _ := loadIso(e)
	if st.Session != "s-live1" {
		t.Errorf("session %q not saved", st.Session)
	}
}

func TestIsoUpSessionFailsCleanlyWhenCrewNewFails(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	fs.paths["git"] = true
	fs.handlers["crew new"] = func(c cmd) (string, string, int) { return "", "no harness", 1 }
	got, code := runJSON(t, e, "iso", "up", "--session")
	if code != 1 || !strings.Contains(problemText(got), "no harness") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	if len(fs.killed) != 2 {
		t.Errorf("did not stop what it started: %v", fs.killed)
	}
}

func TestIsoUpGivesTheFakeOmpAStepsFileSoItHoldsItsPane(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	got, code := runJSON(t, e, "iso", "up")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	fake, err := filepath.Abs(filepath.Join("..", "..", "test", "e2e", "testdata", "bin", "omp"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	c := exec.CommandContext(ctx, fake)
	c.Env = append(os.Environ(), "CREW_E2E="+filepath.Join(got["home"].(string), "e2e"), "CREW_HOME="+t.TempDir())
	out, err := c.CombinedOutput()
	if ctx.Err() == nil {
		t.Errorf("the fake omp exited before the timeout: %v: %s", err, out)
	}
}

func TestIsoUpSecondStartsASecondCrewAndAddsItToTheApp(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	got, code := runJSON(t, e, "iso", "up", "--second")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	st, err := loadIso(e)
	if err != nil {
		t.Fatal(err)
	}
	if st.Second == nil {
		t.Fatal("no second crew in the state")
	}
	if st.Second.Home == st.Home || !strings.HasPrefix(st.Second.Home, "/tmp/crew-iso-") {
		t.Errorf("second home %q", st.Second.Home)
	}
	if st.Second.ServeURL == "" || st.Second.ServeURL == st.ServeURL || st.Second.Token == "" {
		t.Errorf("second serve %q token set %v", st.Second.ServeURL, st.Second.Token != "")
	}
	if got["second_serve_url"] != st.Second.ServeURL {
		t.Errorf("result second_serve_url = %v", got["second_serve_url"])
	}
	if got["second_token"] != nil {
		t.Error("the second token is printed")
	}
	var names []string
	for _, c := range fs.calls {
		if strings.HasSuffix(c.cmd.name, "/crew") && len(c.cmd.args) > 1 && c.cmd.args[0] == "daemon" && c.cmd.args[1] == "start" {
			names = append(names, envOf(c.cmd)["CREW_HOME"]+"="+envOf(c.cmd)["CREW_MACHINE_NAME"])
		}
	}
	if len(names) != 2 || names[1] != st.Second.Home+"=devbox" {
		t.Errorf("daemon starts %v", names)
	}
	b, err := os.ReadFile(filepath.Join(st.Home, "home", ".local", "share", "sh.giovani.crew", "machines.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Machines []struct {
			ID   string            `json:"id"`
			Kind string            `json:"kind"`
			URL  string            `json:"url"`
			Auth map[string]string `json:"auth"`
		} `json:"machines"`
	}
	if err := json.Unmarshal(b, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Machines) != 2 || file.Machines[0].Kind != "this" || file.Machines[1].Kind != "url" || file.Machines[1].URL != st.Second.ServeURL+"/" || file.Machines[1].Auth["token"] != st.Second.Token {
		t.Errorf("machines.json %s", b)
	}
	second := st.Second.Home
	runJSON(t, e, "iso", "down")
	if _, err := os.Stat(second); !os.IsNotExist(err) {
		t.Errorf("second home %s still exists", second)
	}
}
