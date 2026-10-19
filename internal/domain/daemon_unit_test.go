package domain

import (
	"strings"
	"testing"
)

func TestDaemonUnitHealth(t *testing.T) {
	healthy := DaemonUnit{ExecPath: "/home/me/.local/bin/crew", ExecExists: true, Self: "/home/me/.local/bin/crew", Active: "active", Sub: "running"}
	cases := []struct {
		name    string
		edit    func(*DaemonUnit)
		execOK  bool
		reasons []string
	}{
		{"healthy", func(*DaemonUnit) {}, true, nil},
		{"healthy after old restarts that ended well", func(u *DaemonUnit) { u.Restarts = 3 }, true, nil},
		{"stopped is not a failure", func(u *DaemonUnit) { u.Active, u.Sub = "inactive", "dead" }, true, nil},
		{"missing binary", func(u *DaemonUnit) { u.ExecPath, u.ExecExists = "/tmp/go-build1/crew.test", false }, false, []string{"/tmp/go-build1/crew.test", "does not exist"}},
		{"no ExecStart", func(u *DaemonUnit) { u.ExecPath, u.ExecExists = "", false }, false, []string{"no ExecStart"}},
		{"another crew", func(u *DaemonUnit) { u.ExecPath = "/opt/old/crew" }, false, []string{"/opt/old/crew", "not this crew", "/home/me/.local/bin/crew"}},
		{"missing binary wins over another crew", func(u *DaemonUnit) { u.ExecPath, u.ExecExists = "/gone/crew", false }, false, []string{"does not exist"}},
		{"auto-restart loop", func(u *DaemonUnit) {
			u.Active, u.Sub, u.Restarts, u.MainStatus = "activating", "auto-restart", 69000, 203
		}, true, []string{"restarts it again and again", "69000 restarts", "exit status 203"}},
		{"auto-restart before the first count", func(u *DaemonUnit) { u.Active, u.Sub = "activating", "auto-restart" }, true, []string{"restarts it again and again"}},
		{"restarts with a failed status", func(u *DaemonUnit) { u.Restarts, u.MainStatus = 2, 1 }, true, []string{"restarts it again and again", "2 restarts", "exit status 1"}},
		{"one failed exit without restarts", func(u *DaemonUnit) { u.Active, u.MainStatus = "failed", 1 }, true, []string{"stopped with exit status 1"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			u := healthy
			c.edit(&u)
			execOK, reason := DaemonUnitHealth(u)
			if execOK != c.execOK {
				t.Errorf("exec ok %v, want %v", execOK, c.execOK)
			}
			if len(c.reasons) == 0 && reason != "" {
				t.Errorf("reason %q, want none", reason)
			}
			if len(c.reasons) > 0 && reason == "" {
				t.Errorf("no reason, want %q", c.reasons)
			}
			for _, want := range c.reasons {
				if !strings.Contains(reason, want) {
					t.Errorf("reason %q has no %q", reason, want)
				}
			}
		})
	}
}
