package domain

import (
	"strings"
	"testing"
)

func TestEnvTOML(t *testing.T) {
	cases := []struct {
		env  Environment
		want string
	}{
		{Environment{Name: "work", Kind: EnvLocal}, "[[env]]\nname = \"work\"\nkind = \"local\"\n"},
		{Environment{Name: "test-bot", Kind: EnvCustom, Parts: []EnvPart{EnvGit, EnvGitHub}, Extra: []string{"LINEAR_API_KEY"}},
			"[[env]]\nname = \"test-bot\"\nkind = \"custom\"\nparts = [\"git\", \"github\"]\nextra = [\"LINEAR_API_KEY\"]\n"},
	}
	for _, tc := range cases {
		if got := EnvTOML(tc.env); got != tc.want {
			t.Errorf("got\n%s\nwant\n%s", got, tc.want)
		}
	}
}

func TestSetAndRemoveEnvBlock(t *testing.T) {
	src := "[defaults]\nx = 1\n\n[[mate]]\nname = \"bot\"\nprompt = \"p\"\nagent = \"claude\"\n"
	a := Environment{Name: "a", Kind: EnvCustom}
	b := Environment{Name: "bot", Kind: EnvLocal}
	next := SetEnvBlock(SetEnvBlock(src, a), b)
	if !strings.Contains(next, "[[mate]]\nname = \"bot\"\nprompt") {
		t.Fatalf("mate block changed:\n%s", next)
	}
	if strings.Count(next, "[[env]]") != 2 {
		t.Fatalf("want two env blocks:\n%s", next)
	}
	a.Parts = []EnvPart{EnvSSH}
	again := SetEnvBlock(next, a)
	if strings.Count(again, "[[env]]") != 2 || !strings.Contains(again, "parts = [\"ssh\"]") {
		t.Fatalf("replace failed:\n%s", again)
	}
	gone := RemoveEnvBlock(again, "bot")
	if strings.Count(gone, "[[env]]") != 1 || !strings.Contains(gone, "name = \"bot\"\nprompt") {
		t.Fatalf("remove failed:\n%s", gone)
	}
	if RemoveEnvBlock(gone, "nope") != gone {
		t.Fatal("removing an unknown env changed the text")
	}
	if got := SetEnvBlock("", a); got != EnvTOML(a) {
		t.Fatalf("empty src: %q", got)
	}
}

func TestMateTOMLHasEnv(t *testing.T) {
	m := validMate()
	if strings.Contains(MateTOML(m), "env =") {
		t.Fatal("empty env written")
	}
	m.Env = "test-bot"
	if !strings.Contains(MateTOML(m), "env = \"test-bot\"\n") {
		t.Fatalf("env not written:\n%s", MateTOML(m))
	}
}

func TestValidateMateEnv(t *testing.T) {
	envs := []Environment{{Name: "test-bot", Kind: EnvCustom}}
	cases := []struct {
		env string
		ok  bool
	}{{"", true}, {"local", true}, {"test-bot", true}, {"other", false}}
	for _, tc := range cases {
		m := validMate()
		m.Env = tc.env
		err := ValidateMateEnv(m, envs)
		if (err == nil) != tc.ok {
			t.Errorf("env %q: err=%v", tc.env, err)
		}
		if err != nil && !strings.Contains(err.Error(), tc.env) {
			t.Errorf("error does not name the env: %v", err)
		}
	}
}

func TestMatesUsingEnv(t *testing.T) {
	mates := []Mate{{Name: "a", Env: "x"}, {Name: "b"}, {Name: "c", Env: "x"}}
	got := MatesUsingEnv(mates, "x")
	if strings.Join(got, ",") != "a,c" {
		t.Errorf("got %v", got)
	}
}
