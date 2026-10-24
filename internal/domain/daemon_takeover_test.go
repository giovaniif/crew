package domain

import "testing"

func TestOnHeldLock(t *testing.T) {
	cases := []struct {
		name         string
		underService bool
		sameBuild    bool
		want         HeldLock
	}{
		{"the service takes over from a daemon of the same build", true, true, HeldLockTakeOver},
		{"the service takes over from a daemon that does not answer", true, false, HeldLockTakeOver},
		{"a daemon outside the service exits zero for the same build", false, true, HeldLockExit},
		{"a daemon outside the service fails when the holder does not answer", false, false, HeldLockFail},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := OnHeldLock(c.underService, c.sameBuild); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestUnderService(t *testing.T) {
	cases := []struct {
		name string
		goos string
		env  map[string]string
		want bool
	}{
		{"a systemd unit sets INVOCATION_ID", "linux", map[string]string{"INVOCATION_ID": "abc"}, true},
		{"a shell on linux", "linux", map[string]string{}, false},
		{"the launchd agent of the daemon", "darwin", map[string]string{"XPC_SERVICE_NAME": "dev.crew.daemon"}, true},
		{"a Terminal on macOS sets XPC_SERVICE_NAME to 0", "darwin", map[string]string{"XPC_SERVICE_NAME": "0"}, false},
		{"another launchd agent", "darwin", map[string]string{"XPC_SERVICE_NAME": "dev.crew.serve"}, false},
		{"INVOCATION_ID means nothing on macOS", "darwin", map[string]string{"INVOCATION_ID": "abc"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			get := func(k string) string { return c.env[k] }
			if got := UnderService(c.goos, get, "dev.crew.daemon"); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestReplacedBinary(t *testing.T) {
	cases := map[string]bool{
		"/home/me/.local/bin/crew":           false,
		"/home/me/.local/bin/crew (deleted)": true,
		"":                                   false,
	}
	for exe, want := range cases {
		if got := ReplacedBinary(exe); got != want {
			t.Fatalf("%q: got %v, want %v", exe, got, want)
		}
	}
}
