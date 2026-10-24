package domain

import (
	"slices"
	"strings"
	"testing"
)

func TestIdentityTOML(t *testing.T) {
	cases := []struct {
		env  Environment
		want string
	}{
		{Environment{Name: IdentityYours, Label: "Your accounts", Kind: EnvLocal, Extra: []string{"TEST_A"}},
			"[[identity]]\nid = \"yours\"\nname = \"Your accounts\"\nkind = \"yours\"\nextra = [\"TEST_A\"]\n"},
		{Environment{Name: "bot", Kind: EnvCustom, Parts: []EnvPart{EnvGit}},
			"[[identity]]\nid = \"bot\"\nname = \"bot\"\nkind = \"separate\"\nparts = [\"git\"]\n"},
	}
	for _, tc := range cases {
		if got := IdentityTOML(tc.env); got != tc.want {
			t.Errorf("got\n%s\nwant\n%s", got, tc.want)
		}
	}
}

func TestSetAndRemoveIdentityBlock(t *testing.T) {
	a := Environment{Name: "a", Kind: EnvCustom}
	y := Environment{Name: IdentityYours, Label: "Your accounts", Kind: EnvLocal}
	next := SetIdentityBlock(SetIdentityBlock("[x]\ny = 1\n", a), y)
	if strings.Count(next, "[[identity]]") != 2 || !strings.HasPrefix(next, "[x]\ny = 1\n") {
		t.Fatalf("set:\n%s", next)
	}
	y.Extra = []string{"TEST_B"}
	again := SetIdentityBlock(next, y)
	if strings.Count(again, "[[identity]]") != 2 || !strings.Contains(again, "TEST_B") {
		t.Fatalf("replace:\n%s", again)
	}
	gone := RemoveIdentityBlock(again, "a")
	if strings.Count(gone, "[[identity]]") != 1 || strings.Contains(gone, `id = "a"`) {
		t.Fatalf("remove:\n%s", gone)
	}
}

func TestMateTOMLWritesTheEnvironmentTable(t *testing.T) {
	m := Mate{Name: "ada", Prompt: "p", Agent: "claude", Env: "bot", Machine: "m-test", Enabled: true}
	got := MateTOML(m)
	if !strings.Contains(got, "environment = { machine_id = \"m-test\", identity_id = \"bot\" }\n") || strings.Contains(got, "env = ") {
		t.Fatalf("got\n%s", got)
	}
	m.Machine = ""
	if got := MateTOML(m); !strings.Contains(got, "env = \"bot\"\n") {
		t.Fatalf("no machine:\n%s", got)
	}
}

func TestPlanIdentityMigration(t *testing.T) {
	mate := func(name, env string) Mate {
		return Mate{Name: name, Prompt: "p", Agent: "claude", Env: env, Enabled: true}
	}
	block := func(m Mate) string {
		return "[[mate]]\nname = \"" + m.Name + "\"\nprompt = \"p\"\nagent = \"claude\"\n"
	}
	envBlock := func(e Environment) string { return EnvTOML(e) }
	local := Environment{Name: "home", Kind: EnvLocal, Extra: []string{"TEST_X"}}
	local2 := Environment{Name: "work", Kind: EnvLocal, Extra: []string{"TEST_Y"}}
	custom := Environment{Name: "bot", Kind: EnvCustom, Parts: []EnvPart{EnvGit, EnvClaude}, Extra: []string{"TEST_Z"}}
	cases := []struct {
		name       string
		envs       []Environment
		mates      []Mate
		changed    bool
		identities []string
		mateIDs    map[string]string
		moves      []IdentityMove
	}{
		{name: "no env and no mate"},
		{name: "no env, a mate with empty env", mates: []Mate{mate("ada", "")}, changed: true,
			mateIDs: map[string]string{"ada": IdentityYours}},
		{name: "one local", envs: []Environment{local}, mates: []Mate{mate("ada", "home"), mate("bo", "local")}, changed: true,
			identities: []string{"[[identity]]\nid = \"yours\"\nname = \"Your accounts\"\nkind = \"yours\"\nextra = [\"TEST_X\"]\n"},
			mateIDs:    map[string]string{"ada": IdentityYours, "bo": IdentityYours},
			moves:      []IdentityMove{{From: "home", To: IdentityYours}}},
		{name: "two local", envs: []Environment{local, local2}, mates: []Mate{mate("ada", "work")}, changed: true,
			identities: []string{"id = \"yours\"", "[[identity]]\nid = \"work\"\nname = \"work\"\nkind = \"separate\"\nextra = [\"TEST_Y\"]\n"},
			mateIDs:    map[string]string{"ada": "work"},
			moves:      []IdentityMove{{From: "home", To: IdentityYours}, {From: "work", To: "work"}}},
		{name: "custom", envs: []Environment{custom}, mates: []Mate{mate("ada", "bot"), mate("bo", "")}, changed: true,
			identities: []string{"[[identity]]\nid = \"bot\"\nname = \"bot\"\nkind = \"separate\"\nparts = [\"git\", \"claude\"]\nextra = [\"TEST_Z\"]\n"},
			mateIDs:    map[string]string{"ada": "bot", "bo": IdentityYours},
			moves:      []IdentityMove{{From: "bot", To: "bot"}}},
		{name: "mate with X", mates: []Mate{mate("ada", "x")}, changed: true, mateIDs: map[string]string{"ada": "x"}},
		{name: "done before", mates: []Mate{{Name: "ada", Prompt: "p", Agent: "claude", Env: IdentityYours, Machine: "m-test", Enabled: true}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "# keep me\n[fallback]\nthreshold = 30\n"
			for _, e := range tc.envs {
				src += "\n" + envBlock(e)
			}
			for _, m := range tc.mates {
				src += "\n" + block(m)
				if m.Env != "" {
					src += "env = \"" + m.Env + "\"\n"
				}
			}
			plan := PlanIdentityMigration(src, tc.envs, tc.mates, "m-test")
			if plan.Changed != tc.changed {
				t.Fatalf("changed = %v, want %v", plan.Changed, tc.changed)
			}
			if !tc.changed {
				if plan.Text != src || len(plan.Moves) != 0 {
					t.Fatalf("an unchanged plan changed the text or has moves: %+v", plan)
				}
				return
			}
			if !strings.HasPrefix(plan.Text, "# keep me\n[fallback]\nthreshold = 30\n") {
				t.Fatalf("lost the head:\n%s", plan.Text)
			}
			if strings.Contains(plan.Text, "[[env]]") || strings.Contains(plan.Text, "\nenv = ") {
				t.Fatalf("old keys stay:\n%s", plan.Text)
			}
			if strings.Count(plan.Text, "[[identity]]") != len(tc.envs) {
				t.Fatalf("identities:\n%s", plan.Text)
			}
			for _, want := range tc.identities {
				if !strings.Contains(plan.Text, want) {
					t.Errorf("missing %q in\n%s", want, plan.Text)
				}
			}
			for name, id := range tc.mateIDs {
				line := "environment = { machine_id = \"m-test\", identity_id = \"" + id + "\" }"
				if !strings.Contains(plan.Text, "name = \""+name+"\"") || !strings.Contains(plan.Text, line) {
					t.Errorf("mate %s: want %s in\n%s", name, line, plan.Text)
				}
			}
			if strings.Count(plan.Text, "environment = {") != len(tc.mates) {
				t.Errorf("each mate needs one environment:\n%s", plan.Text)
			}
			if !slices.Equal(plan.Moves, tc.moves) {
				t.Errorf("moves = %v, want %v", plan.Moves, tc.moves)
			}
		})
	}
}

func TestValidateMateEnvTakesYours(t *testing.T) {
	if err := ValidateMateEnv(Mate{Name: "ada", Env: IdentityYours}, nil); err != nil {
		t.Fatal(err)
	}
}
