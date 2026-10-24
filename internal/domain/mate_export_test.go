package domain

import (
	"reflect"
	"testing"
)

func TestMateImportName(t *testing.T) {
	cases := []struct {
		name string
		used []string
		want string
	}{
		{"ada", nil, "ada"},
		{"ada", []string{"bo"}, "ada"},
		{"ada", []string{"ada"}, "ada-2"},
		{"ada", []string{"ada", "ada-2"}, "ada-3"},
		{"ada", []string{"ada", "ada-3"}, "ada-2"},
		{"ada-2", []string{"ada-2"}, "ada-2-2"},
	}
	for _, tc := range cases {
		if got := MateImportName(tc.name, tc.used); got != tc.want {
			t.Errorf("MateImportName(%q, %v) = %q, want %q", tc.name, tc.used, got, tc.want)
		}
	}
}

func TestMateImportNameKeepsTheNameRule(t *testing.T) {
	long := "abcdefghijklmnopqrstuvwxyz012345"
	got := MateImportName(long, []string{long})
	if !ValidMateName(got) || got == long {
		t.Fatalf("got %q", got)
	}
}

func TestExportableMateKeepsTheRoleAndTheLookOnly(t *testing.T) {
	m := Mate{Name: "ada", Prompt: "p", Agent: "codex", Model: "m", Effort: "high", Repos: []string{"api"},
		Owner: "U012ABCDEF", Avatar: "fox", Color: "#112233", Env: "bot", Machine: "m-test", Tone: MateTone{Terse: 1}, NoMemory: true, Enabled: false}
	want := Mate{Name: "ada", Prompt: "p", Agent: "codex", Model: "m", Effort: "high", Repos: []string{"api"},
		Avatar: "fox", Color: "#112233", Tone: MateTone{Terse: 1}, NoMemory: true, Enabled: true}
	if got := ExportableMate(m); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}
