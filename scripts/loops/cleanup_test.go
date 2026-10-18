package loops

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func setup(t *testing.T) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	git(t, root, "init", "-q", "-b", "main", repo)
	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, repo, "add", "a.txt")
	git(t, repo, "commit", "-q", "-m", "init")
	wt := filepath.Join(root, "wt")
	git(t, repo, "worktree", "add", "-q", "-b", "fix-1", wt)
	return repo, wt, filepath.Join(root, "backup")
}

func runCleanup(t *testing.T, repo, backup string, wts ...string) string {
	t.Helper()
	script, err := filepath.Abs("cleanup")
	if err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(script, append([]string{repo, backup}, wts...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("cleanup: %v\n%s", err, out)
	}
	return string(out)
}

func TestCleanupRemovesACleanWorktreeAndKeepsItsBranch(t *testing.T) {
	repo, wt, backup := setup(t)
	runCleanup(t, repo, backup, wt)
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
	if !strings.Contains(git(t, repo, "branch", "--list", "fix-1"), "fix-1") {
		t.Fatal("branch fix-1 was deleted")
	}
}

func TestCleanupBacksUpUncommittedChangesBeforeItRemovesTheWorktree(t *testing.T) {
	repo, wt, backup := setup(t)
	if err := os.WriteFile(filepath.Join(wt, "a.txt"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wt, "new.txt"), []byte("untracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runCleanup(t, repo, backup, wt)
	patches, _ := filepath.Glob(filepath.Join(backup, "*.patch"))
	if len(patches) != 1 {
		t.Fatalf("want one patch, got %v", patches)
	}
	body, _ := os.ReadFile(patches[0])
	if !strings.Contains(string(body), "+changed") || !strings.Contains(string(body), "+untracked") {
		t.Fatalf("patch misses the changes:\n%s", body)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
}

func TestCleanupKeepsAWorktreeThatAProcessUses(t *testing.T) {
	repo, wt, backup := setup(t)
	cmd := exec.Command("sleep", "30")
	cmd.Dir = wt
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	out := runCleanup(t, repo, backup, wt)
	if _, err := os.Stat(wt); err != nil {
		t.Fatalf("worktree in use was removed: %v", err)
	}
	if !strings.Contains(out, "in use") {
		t.Fatalf("want an in use note, got %q", out)
	}
}
