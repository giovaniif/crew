package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

func fakeProc(t *testing.T, dir string, pid int, exe string, args ...string) {
	t.Helper()
	p := filepath.Join(dir, strconv.Itoa(pid))
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(exe, filepath.Join(p, "exe")); err != nil {
		t.Fatal(err)
	}
	var cmdline []byte
	for _, a := range args {
		cmdline = append(cmdline, a...)
		cmdline = append(cmdline, 0)
	}
	if err := os.WriteFile(filepath.Join(p, "cmdline"), cmdline, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStaleCrewProcsFindsCrewProcessesWhoseBinaryWasReplaced(t *testing.T) {
	dir := t.TempDir()
	fakeProc(t, dir, 10, "/home/me/.local/bin/crew (deleted)", "/home/me/.local/bin/crew", "serve", "--addr", "127.0.0.1:7420")
	fakeProc(t, dir, 11, "/home/me/.local/bin/crew", "/home/me/.local/bin/crew", "daemon")
	fakeProc(t, dir, 12, "/usr/bin/vim (deleted)", "vim")
	fakeProc(t, dir, 13, "/opt/crew/crew (deleted)", "/opt/crew/crew", "daemon")
	if err := os.WriteFile(filepath.Join(dir, "uptime"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	got := staleCrewProcs(dir)
	want := []staleProc{{PID: 10, Command: "crew serve"}, {PID: 13, Command: "crew daemon"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
