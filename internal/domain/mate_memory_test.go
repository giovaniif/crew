package domain

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestMateSystemPrompt(t *testing.T) {
	m := Mate{Name: "reviewer", Prompt: "Review code.\n", Agent: "claude"}
	path := "/h/.crew/mates/reviewer/memory.md"
	cases := []struct {
		name   string
		memory string
		has    []string
		hasNot []string
	}{
		{"no memory yet", "", []string{"Review code.", path, "no notes yet"}, []string{"too large"}},
		{"memory after the prompt", "- The owner likes short PRs.\n", []string{"Review code.", "- The owner likes short PRs.", path}, []string{"no notes yet", "too large"}},
		{"blank memory counts as none", " \n\n", []string{"no notes yet"}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := MateSystemPrompt(m, tc.memory, path)
			if !strings.HasPrefix(got, "Review code.") {
				t.Errorf("the prompt of the mate comes first:\n%s", got)
			}
			for _, s := range tc.has {
				if !strings.Contains(got, s) {
					t.Errorf("missing %q in:\n%s", s, got)
				}
			}
			for _, s := range tc.hasNot {
				if strings.Contains(got, s) {
					t.Errorf("unexpected %q in:\n%s", s, got)
				}
			}
		})
	}
}

func TestMateSystemPromptPutsTheMemoryAfterThePrompt(t *testing.T) {
	got := MateSystemPrompt(Mate{Name: "a", Prompt: "PROMPT"}, "NOTE", "/m.md")
	if strings.Index(got, "PROMPT") >= strings.Index(got, "NOTE") {
		t.Errorf("order:\n%s", got)
	}
}

func TestMateSystemPromptKeepsOnlyTheLastPartOfAMemoryOverTheLimit(t *testing.T) {
	memory := "OLDEST\n" + strings.Repeat("é", MateMemoryLimit) + "\nNEWEST"
	got := MateSystemPrompt(Mate{Name: "a", Prompt: "p"}, memory, "/m.md")
	if strings.Contains(got, "OLDEST") || !strings.Contains(got, "NEWEST") {
		t.Errorf("want only the tail of the memory")
	}
	if !strings.Contains(got, "too large") {
		t.Errorf("want an instruction to make the file shorter")
	}
	if !utf8.ValidString(got) {
		t.Errorf("the cut splits a character")
	}
	if len(got) > MateMemoryLimit+2048 {
		t.Errorf("system prompt is %d bytes", len(got))
	}
}

func TestMateSystemPromptAtTheLimitKeepsAllOfIt(t *testing.T) {
	memory := "FIRST" + strings.Repeat("x", MateMemoryLimit-5)
	got := MateSystemPrompt(Mate{Name: "a", Prompt: "p"}, memory, "/m.md")
	if !strings.Contains(got, "FIRST") || strings.Contains(got, "too large") {
		t.Errorf("a memory of exactly the limit stays whole")
	}
}

func TestCheckMateMemory(t *testing.T) {
	if err := CheckMateMemory(strings.Repeat("x", MateMemoryLimit)); err != nil {
		t.Errorf("at the limit: %v", err)
	}
	if err := CheckMateMemory(""); err != nil {
		t.Errorf("empty clears: %v", err)
	}
	err := CheckMateMemory(strings.Repeat("x", MateMemoryLimit+1))
	if err == nil || !strings.Contains(err.Error(), "8192") {
		t.Errorf("over the limit: %v", err)
	}
}

func TestMateRepoWorkspace(t *testing.T) {
	m := Mate{Name: "a", Repos: []string{"solo"}}
	ws := append([]Workspace{{Root: "/w/two", Kind: WorkspaceSingle, Repos: []Repo{{Name: "two", Path: "/w/two"}}}}, mateWorkspaces...)
	cases := []struct {
		name, repo, want string
		ok               bool
	}{
		{"the first repo of the mate", "", "/w/solo", true},
		{"a repo by name", "two", "/w/two", true},
		{"a repo by path", "/w/two", "/w/two", true},
		{"a repo of an orchestration workspace", "api", "", false},
		{"an unknown repo", "nope", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := MateRepoWorkspace(m, ws, tc.repo)
			if ok != tc.ok || got.Root != tc.want {
				t.Errorf("got %q %v, want %q %v", got.Root, ok, tc.want, tc.ok)
			}
		})
	}
}
