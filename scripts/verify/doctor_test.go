package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func healthy(e *env, fs *fakeSys) {
	_ = os.MkdirAll(filepath.Join(e.repo, "web", "node_modules"), 0o755)
	for _, p := range []string{"go", "git", "tmux", "node"} {
		fs.paths[p] = true
	}
	fs.handlers["node --version"] = func(cmd) (string, string, int) { return "v22.18.0\n", "", 0 }
	fs.handlers["git rev-parse"] = func(c cmd) (string, string, int) {
		if c.args[len(c.args)-1] == "--abbrev-ref" || strings.Contains(strings.Join(c.args, " "), "abbrev-ref") {
			return "main\n", "", 0
		}
		return "abc\n", "", 0
	}
	fs.handlers["git rev-list"] = func(cmd) (string, string, int) { return "0\n", "", 0 }
	fs.handlers["node -e"] = func(cmd) (string, string, int) { return "/fake/chromium\n", "", 0 }
}

func TestDoctorHealthyMachineIsOK(t *testing.T) {
	e, fs := testEnv(t)
	healthy(e, fs)
	got, code := runJSON(t, e, "doctor")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	if got["branch"] != "main" {
		t.Errorf("branch = %v", got["branch"])
	}
}

func TestDoctorReportsMissingToolsOldNodeAndLoad(t *testing.T) {
	e, fs := testEnv(t)
	healthy(e, fs)
	delete(fs.paths, "tmux")
	fs.handlers["node --version"] = func(cmd) (string, string, int) { return "v22.17.9\n", "", 0 }
	fs.loadAvg = 40
	fs.cpus = 8
	got, code := runJSON(t, e, "doctor")
	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	text := problemText(got)
	for _, want := range []string{"tmux", "node v22.17.9", "load"} {
		if !strings.Contains(text, want) {
			t.Errorf("problems %q do not name %q", text, want)
		}
	}
	if strings.Contains(text, "freeze") {
		t.Errorf("problems %q still name freeze", text)
	}
}

func TestDoctorReportsBehindMainAndBusyPorts(t *testing.T) {
	e, fs := testEnv(t)
	healthy(e, fs)
	fs.handlers["git rev-list"] = func(cmd) (string, string, int) { return "3\n", "", 0 }
	fs.busy[5199] = true
	got, code := runJSON(t, e, "doctor")
	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	text := problemText(got)
	if !strings.Contains(text, "3 commits behind origin/main") {
		t.Errorf("problems %q", text)
	}
	if !strings.Contains(text, "5199") {
		t.Errorf("problems %q do not name the busy port", text)
	}
}

func TestNodeVersionAtLeast(t *testing.T) {
	tests := []struct {
		v    string
		want bool
	}{
		{"v22.18.0", true},
		{"v22.17.9", false},
		{"v24.1.0", true},
		{"v21.99.0", false},
		{"junk", false},
	}
	for _, tt := range tests {
		if got := nodeOK(tt.v); got != tt.want {
			t.Errorf("nodeOK(%q) = %v, want %v", tt.v, got, tt.want)
		}
	}
}

func TestDoctorReportsMissingWebNodeModulesWithTheFix(t *testing.T) {
	e, fs := testEnv(t)
	healthy(e, fs)
	_ = os.RemoveAll(filepath.Join(e.repo, "web", "node_modules"))
	got, code := runJSON(t, e, "doctor")
	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	text := problemText(got)
	if !strings.Contains(text, "web/node_modules") || !strings.Contains(text, "npm ci") {
		t.Errorf("problems %q do not name web/node_modules and npm ci", text)
	}
}
