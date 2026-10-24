package domain

import "testing"

func TestHooksAreMissingOnlyWhenCrewSetThemUpBefore(t *testing.T) {
	cases := []struct {
		name   string
		setup  HarnessSetup
		ok     bool
		reason string
	}{
		{"never set up", HarnessSetup{File: "/home/u/.claude/settings.json"}, false, ""},
		{"installed", HarnessSetup{File: "/home/u/.claude/settings.json", SetUp: true, Installed: true}, false, ""},
		{"removed by another tool", HarnessSetup{File: "/home/u/.claude/settings.json", SetUp: true}, true, "crew hooks are missing in ~/.claude/settings.json"},
		{"outside home", HarnessSetup{File: "/etc/claude/settings.json", SetUp: true}, true, "crew hooks are missing in /etc/claude/settings.json"},
		{"home prefix only", HarnessSetup{File: "/home/u2/settings.json", SetUp: true}, true, "crew hooks are missing in /home/u2/settings.json"},
		{"unreadable", HarnessSetup{File: "/home/u/.codex/hooks.json", SetUp: true, Err: "bad JSON"}, true, "crew can not read ~/.codex/hooks.json: bad JSON"},
		{"unreadable but never set up", HarnessSetup{File: "/home/u/.codex/hooks.json", Err: "bad JSON"}, false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := CheckHooks("local", HarnessClaude, c.setup, "/home/u")
			if ok != c.ok || got.Reason != c.reason {
				t.Fatalf("CheckHooks = %+v, %v; want %v, %q", got, ok, c.ok, c.reason)
			}
			if ok && (got.Env != "local" || got.Harness != HarnessClaude || got.File != c.setup.File) {
				t.Errorf("CheckHooks = %+v, want env local, harness claude, file %s", got, c.setup.File)
			}
		})
	}
}

func TestACustomEnvironmentHasAHarnessDirOnlyForItsParts(t *testing.T) {
	env := Environment{Name: "work", Kind: EnvCustom, Home: "/crew/envs/work", Parts: []EnvPart{EnvClaude, EnvPi}}
	cases := []struct {
		env  Environment
		h    Harness
		want string
	}{
		{env, HarnessClaude, "/crew/envs/work/claude"},
		{env, HarnessOmp, "/crew/envs/work/omp"},
		{env, HarnessCodex, ""},
		{Environment{Name: "local", Kind: EnvLocal, Home: "/x", Parts: []EnvPart{EnvClaude}}, HarnessClaude, ""},
		{Environment{Name: "bare", Kind: EnvCustom, Parts: []EnvPart{EnvClaude}}, HarnessClaude, ""},
	}
	for _, c := range cases {
		if got := EnvHarnessDir(c.env, c.h); got != c.want {
			t.Errorf("EnvHarnessDir(%s, %s) = %q, want %q", c.env.Name, c.h, got, c.want)
		}
	}
}
