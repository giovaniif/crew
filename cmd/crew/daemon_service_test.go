package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/rpc"
)

func (f *daemonSetupFixture) env(crewHome string) func(string) string {
	return envOf(map[string]string{"CREW_HOME": crewHome, "PATH": f.bin, "SHELL": f.shell, "USER": "me"})
}

func (f *daemonSetupFixture) install(t *testing.T, goos, crewHome, self string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if code := runSetupDaemon(nil, &stdout, &stderr, f.env(crewHome), self, goos); code != 0 {
		t.Fatalf("install: code %d err %q", code, stderr.String())
	}
	_ = os.Remove(f.manager)
}

func TestSpawnStartsTheDaemonThroughTheInstalledSystemdUnit(t *testing.T) {
	f := newDaemonSetupFixture(t, "linux", "yes")
	home, self := shortHome(t), selfBinary(t)
	f.install(t, "linux", home, self)
	started, err := serviceStart(context.Background(), home, f.env(home), self, "linux")
	if err != nil || !started {
		t.Fatalf("started %v err %v", started, err)
	}
	calls, _ := os.ReadFile(f.manager)
	if !strings.Contains(string(calls), "--user start crew-daemon.service") {
		t.Fatalf("systemctl calls %q", calls)
	}
}

func TestSpawnStartsTheDaemonThroughTheInstalledLaunchdAgent(t *testing.T) {
	f := newDaemonSetupFixture(t, "darwin", "yes")
	home, self := shortHome(t), selfBinary(t)
	f.install(t, "darwin", home, self)
	started, err := serviceStart(context.Background(), home, f.env(home), self, "darwin")
	if err != nil || !started {
		t.Fatalf("started %v err %v", started, err)
	}
	calls, _ := os.ReadFile(f.manager)
	if want := fmt.Sprintf("kickstart gui/%d/dev.crew.daemon", os.Getuid()); !strings.Contains(string(calls), want) {
		t.Fatalf("launchctl calls %q, want %q", calls, want)
	}
}

func TestSpawnForksWhenTheUnitIsForAnotherCrewHome(t *testing.T) {
	f := newDaemonSetupFixture(t, "linux", "yes")
	self := selfBinary(t)
	f.install(t, "linux", shortHome(t), self)
	started, err := serviceStart(context.Background(), shortHome(t), f.env(shortHome(t)), self, "linux")
	if err != nil || started {
		t.Fatalf("started %v err %v", started, err)
	}
	if _, err := os.Stat(f.manager); !os.IsNotExist(err) {
		t.Fatal("systemctl ran for a unit of another home")
	}
}

func TestDaemonStopGoesThroughTheInstalledSystemdUnit(t *testing.T) {
	f := newDaemonSetupFixture(t, "linux", "yes")
	home, self := shortHome(t), selfBinary(t)
	f.install(t, "linux", home, self)
	stopped, err := serviceStop(context.Background(), home, f.env(home), self, "linux")
	if err != nil || !stopped {
		t.Fatalf("stopped %v err %v", stopped, err)
	}
	calls, _ := os.ReadFile(f.manager)
	if !strings.Contains(string(calls), "--user stop crew-daemon.service") {
		t.Fatalf("systemctl calls %q", calls)
	}
}

func TestSetupDaemonUnitRestartsOnlyAfterAFailure(t *testing.T) {
	f := newDaemonSetupFixture(t, "linux", "yes")
	f.install(t, "linux", shortHome(t), "/bin/crew")
	unit, _ := os.ReadFile(f.path)
	if !strings.Contains(string(unit), "Restart=on-failure\n") {
		t.Fatalf("unit\n%s", unit)
	}
}

func TestSetupDaemonAgentKeepsAliveOnlyAfterAFailure(t *testing.T) {
	f := newDaemonSetupFixture(t, "darwin", "yes")
	f.install(t, "darwin", shortHome(t), "/bin/crew")
	plist, _ := os.ReadFile(f.path)
	if !strings.Contains(string(plist), "<key>SuccessfulExit</key>\n\t\t<false/>") {
		t.Fatalf("plist\n%s", plist)
	}
}

func TestSetupDaemonCheckFindsAnOldUnitThatRestartsAfterACleanExit(t *testing.T) {
	f := newDaemonSetupFixture(t, "linux", "yes")
	self := selfBinary(t)
	f.writeUnit(t, `"`+self+`" "daemon"`)
	raw, _ := os.ReadFile(f.path)
	if err := os.WriteFile(f.path, bytes.Replace(raw, []byte("Restart=on-failure"), []byte("Restart=always"), 1), 0o644); err != nil {
		t.Fatal(err)
	}
	fakeTool(t, f.bin, "systemctl", `case "$*" in *" show "*) printf 'ActiveState=active\nSubState=running\n' ;; esac`)
	got := f.checkAs(t, self)
	if got["failing"] != true || !strings.Contains(got["reason"].(string), "clean exit") {
		t.Fatalf("check %v", got)
	}
}

func TestSetupDaemonCheckFindsAnOldLaunchdAgentThatRestartsAfterACleanExit(t *testing.T) {
	f := newDaemonSetupFixture(t, "darwin", "yes")
	if err := os.MkdirAll(filepath.Dir(f.path), 0o755); err != nil {
		t.Fatal(err)
	}
	old := "<plist><dict><key>ProgramArguments</key><array><string>/bin/crew</string><string>daemon</string></array><key>KeepAlive</key><true/></dict></plist>"
	if err := os.WriteFile(f.path, []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	env := envOf(map[string]string{"CREW_HOME": filepath.Join(f.home, ".crew"), "PATH": f.bin, "SHELL": f.shell, "USER": "me"})
	var stdout, stderr bytes.Buffer
	if code := runSetupDaemon([]string{"--check"}, &stdout, &stderr, env, "/bin/crew", "darwin"); code != 0 {
		t.Fatalf("code %d err %q", code, stderr.String())
	}
	var got map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["failing"] != true || !strings.Contains(fmt.Sprint(got["reason"]), "clean exit") {
		t.Fatalf("check %v", got)
	}
}

func TestADaemonThatFindsTheSameBuildRunningExitsZero(t *testing.T) {
	home := shortHome(t)
	t.Setenv("CREW_HOME", home)
	t.Setenv("SHELL", "")
	lock, err := daemon.Acquire(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lock.Release() })
	fakeDaemon(t, home, func(req rpc.Request) *rpc.Response {
		switch req.Method {
		case rpc.MethodStatus:
			return &rpc.Response{V: 1, ID: req.ID, Result: json.RawMessage(fmt.Sprintf(`{"pid":%d}`, os.Getpid()))}
		default:
			return &rpc.Response{V: 1, ID: req.ID, Result: json.RawMessage(`{"workspaces":[]}`)}
		}
	})
	var stdout, stderr bytes.Buffer
	if code := runDaemon(nil, &stdout, &stderr); code != 0 || !strings.Contains(stderr.String(), "already runs") {
		t.Fatalf("code %d err %q", code, stderr.String())
	}
}

func TestADaemonThatFindsTheLockHeldWithNoAnswerStillFails(t *testing.T) {
	home := shortHome(t)
	t.Setenv("CREW_HOME", home)
	t.Setenv("SHELL", "")
	lock, err := daemon.Acquire(home)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lock.Release() })
	var stdout, stderr bytes.Buffer
	if code := runDaemon(nil, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "already running") {
		t.Fatalf("code %d err %q", code, stderr.String())
	}
}
