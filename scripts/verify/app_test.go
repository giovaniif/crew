package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func appReady(t *testing.T, fs *fakeSys) *[]string {
	t.Helper()
	fs.paths["tauri-driver"] = true
	fs.paths["WebKitWebDriver"] = true
	fs.paths["cargo"] = true
	fs.paths["npm"] = true
	var stdin []string
	fs.handlers["node"] = func(c cmd) (string, string, int) {
		stdin = append(stdin, c.stdin)
		return `{"shots":[{"path":"/tmp/x/app-after.png","viewport":"app"}],"eval":[]}` + "\n", "", 0
	}
	return &stdin
}

func TestAppNeedsTheIsolatedCrew(t *testing.T) {
	e, fs := testEnv(t)
	appReady(t, fs)
	got, code := runJSON(t, e, "app", "shot", "/")
	if code != 1 || !strings.Contains(problemText(got), "verify iso up") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}

func TestAppDriveRefusesBadStepsLikeWeb(t *testing.T) {
	e, fs := testEnv(t)
	appReady(t, fs)
	_, code := runJSON(t, e, "app", "drive", "/", "--steps", `[{"click":{"role":"button"}}]`)
	if code != 2 {
		t.Errorf("exit %d, want a usage error", code)
	}
}

func TestAppDriveRunsTheTauriAppWithTheMacGUIPathAgainstTheIsoCrew(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	stdin := appReady(t, fs)
	runJSON(t, e, "iso", "up")
	st, _ := loadIso(e)
	got, code := runJSON(t, e, "app", "drive", "/", "--steps", `[{"click":{"role":"tab","name":"Terminal"}},{"shot":"after.png"}]`)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, problemText(got))
	}
	var cargo *cmd
	for i, c := range fs.calls {
		if filepath.Base(c.cmd.name) == "cargo" && len(c.cmd.args) > 0 && c.cmd.args[0] == "build" {
			cargo = &fs.calls[i].cmd
		}
	}
	if cargo == nil {
		t.Fatal("the app was not built")
	}
	if envOf(*cargo)["CARGO_TARGET_DIR"] == "" {
		t.Error("cargo does not reuse one target dir")
	}
	var driver *cmd
	for i, c := range fs.started {
		if strings.Contains(strings.Join(append([]string{c.name}, c.args...), " "), "tauri-driver") {
			driver = &fs.started[i]
		}
	}
	if driver == nil {
		t.Fatal("tauri-driver was not started")
	}
	vars := envOf(*driver)
	if vars["PATH"] != "/usr/bin:/bin" {
		t.Errorf("the app PATH is %q, want the macOS GUI PATH /usr/bin:/bin", vars["PATH"])
	}
	if vars["CREW_HOME"] != st.Home || vars["CREW_TMUX_SOCKET"] != st.Socket || vars["HOME"] == "" || strings.HasPrefix(vars["HOME"], "/home/") {
		t.Errorf("the app is not on the iso crew: %v", vars)
	}
	if _, ok := vars["CREW_URL"]; ok {
		t.Error("CREW_URL is set, so the app would not start its own crew serve")
	}
	if len(*stdin) != 1 {
		t.Fatalf("the WebDriver runner ran %d times", len(*stdin))
	}
	var req struct {
		Steps []map[string]json.RawMessage `json:"steps"`
		App   string                       `json:"app"`
	}
	if err := json.Unmarshal([]byte((*stdin)[0]), &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Steps) != 3 || string(req.Steps[0]["goto"]) != `"/"` || req.App == "" {
		t.Errorf("request %s", (*stdin)[0])
	}
	shots, _ := got["shots"].([]any)
	if len(shots) != 1 {
		t.Errorf("shots %v", got["shots"])
	}
	if len(fs.killed) != 1 || fs.killed[0] != 9000+len(fs.started) {
		t.Errorf("tauri-driver was not stopped: %v", fs.killed)
	}
}

func TestAppDriveReportsTheFailedStep(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	appReady(t, fs)
	fs.handlers["node"] = func(c cmd) (string, string, int) {
		return `{"shots":[],"error":"app: step 2: no visible match for text=TEST","failed_step":2,"failure":"/tmp/x/app-failure.png"}` + "\n", "", 1
	}
	runJSON(t, e, "iso", "up")
	got, code := runJSON(t, e, "app", "drive", "/", "--steps", `[{"expect":{"text":"TEST"}}]`)
	if code != 1 || !strings.Contains(problemText(got), "no visible match for text=TEST") || got["failed_step"] != float64(2) {
		t.Errorf("exit %d: %s %v", code, problemText(got), got["failed_step"])
	}
}

func TestAppNamesMissingDesktopTools(t *testing.T) {
	e, fs := testEnv(t)
	isoReady(fs)
	appReady(t, fs)
	delete(fs.paths, "tauri-driver")
	runJSON(t, e, "iso", "up")
	got, code := runJSON(t, e, "app", "shot", "/")
	if code != 1 || !strings.Contains(problemText(got), "cargo install tauri-driver --locked") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}
