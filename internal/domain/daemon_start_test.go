package domain

import "testing"

func TestDaemonStarter(t *testing.T) {
	unit := DaemonService{Installed: true, Home: "/home/me/.crew", Exec: "/home/me/.local/bin/crew"}
	cases := []struct {
		name string
		goos string
		edit func(*DaemonService)
		want DaemonStarter
	}{
		{"no unit forks", "linux", func(s *DaemonService) { s.Installed = false }, StartFork},
		{"the unit of this home and binary on linux", "linux", func(*DaemonService) {}, StartSystemd},
		{"the agent of this home and binary on macOS", "darwin", func(*DaemonService) {}, StartLaunchd},
		{"a unit for another home forks", "linux", func(s *DaemonService) { s.Home = "/tmp/other" }, StartFork},
		{"a unit that runs another crew forks", "linux", func(s *DaemonService) { s.Exec = "/opt/old/crew" }, StartFork},
		{"another platform forks", "windows", func(*DaemonService) {}, StartFork},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := unit
			c.edit(&s)
			if got := DaemonStart(c.goos, s, "/home/me/.crew", "/home/me/.local/bin/crew"); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}
