package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testEnv(t *testing.T) (*env, *fakeSys) {
	t.Helper()
	fs := newFakeSys()
	e := &env{
		sys:   fs,
		repo:  t.TempDir(),
		state: shortTempDir(t),
		now:   func() time.Time { return time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC) },
	}
	t.Cleanup(func() {
		if st, err := loadIso(e); err == nil {
			if home := filepath.Clean(st.Home); filepath.Dir(home) == "/tmp" && strings.HasPrefix(home, "/tmp/crew-iso-") {
				_ = os.RemoveAll(home)
			}
		}
	})
	return e, fs
}

func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "vfy")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", args...)
	c.Dir = dir
	c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestUsageErrorsPrintOneJSONObjectAndExit2(t *testing.T) {
	for _, args := range [][]string{nil, {"nope"}, {"iso"}, {"iso", "sideways"}, {"web", "shot"}, {"evidence"}} {
		e, _ := testEnv(t)
		got, code := runJSON(t, e, args...)
		if code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
		if got["ok"] != false {
			t.Errorf("%v: ok = %v", args, got["ok"])
		}
		if problemText(got) == "" {
			t.Errorf("%v: no problem reported", args)
		}
	}
}

func TestSelftestRunsTheGoTestsOfTheCLI(t *testing.T) {
	e, fs := testEnv(t)
	fs.handlers["go test"] = func(c cmd) (string, string, int) { return "ok\n", "", 0 }
	mustOK(t, e, "selftest")
	if !fs.ran("go test ./scripts/verify/") {
		t.Error("did not run the CLI tests")
	}
	fs.handlers["go test"] = func(c cmd) (string, string, int) { return "--- FAIL: TestX\n", "", 1 }
	got, code := runJSON(t, e, "selftest")
	if code != 1 || !strings.Contains(problemText(got), "FAIL") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
}

func TestTheStateDirMustBeAPrivateDirOfThisUser(t *testing.T) {
	root := shortTempDir(t)
	fresh := filepath.Join(root, "new")
	if err := privateState(fresh); err != nil {
		t.Errorf("a new state dir: %v", err)
	}
	if fi, err := os.Stat(fresh); err != nil || fi.Mode().Perm() != 0o700 {
		t.Errorf("the new state dir is not 0700: %v", err)
	}
	open := filepath.Join(root, "open")
	if err := os.Mkdir(open, 0o777); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(open, 0o777); err != nil {
		t.Fatal(err)
	}
	if privateState(open) == nil {
		t.Error("a world-writable state dir is trusted")
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(fresh, link); err != nil {
		t.Fatal(err)
	}
	if privateState(link) == nil {
		t.Error("a symlink state dir is trusted")
	}
}

func TestIsoDownNeverRemovesAPathOutsideAnIsoHome(t *testing.T) {
	e, _ := testEnv(t)
	iso, err := os.MkdirTemp("/tmp", "crew-iso-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(iso) })
	victim := shortTempDir(t)
	write(t, filepath.Join(victim, "keep"), "x")
	if err := saveIso(e, isoState{Home: iso + "/../" + filepath.Base(victim), Bin: "/bin/true"}); err != nil {
		t.Fatal(err)
	}
	mustOK(t, e, "iso", "down")
	if _, err := os.Stat(filepath.Join(victim, "keep")); err != nil {
		t.Errorf("iso down removed %s", victim)
	}
}

func TestEveryProblemHasAHint(t *testing.T) {
	e, _ := testEnv(t)
	got, _ := runJSON(t, e, "doctor")
	for _, p := range got["problems"].([]any) {
		if h, _ := p.(map[string]any)["hint"].(string); h == "" {
			t.Errorf("problem %v has no hint", p)
		}
	}
}

func TestEachCheckoutGetsItsOwnDefaultStateDir(t *testing.T) {
	a := defaultStateDir(1000, "/home/u/crew")
	b := defaultStateDir(1000, "/home/u/work/crew-patrol")
	if a == b {
		t.Fatalf("two checkouts share the state dir %s", a)
	}
	if a != defaultStateDir(1000, "/home/u/crew") {
		t.Fatalf("the state dir of one checkout is not stable")
	}
	if !strings.HasPrefix(a, "/tmp/crew-verify-1000-") {
		t.Fatalf("state dir %s is not under /tmp/crew-verify-<uid>-", a)
	}
	if len(a) > 40 {
		t.Fatalf("state dir %s is too long for Unix sockets", a)
	}
}
