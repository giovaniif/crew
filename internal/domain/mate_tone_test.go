package domain

import (
	"strings"
	"testing"
)

func TestMateToneAxesHaveFiveStepsWithASilentMiddle(t *testing.T) {
	axes := MateToneAxes()
	keys := []string{}
	for _, a := range axes {
		keys = append(keys, a.Key)
		if a.Steps[2] != "" {
			t.Errorf("%s: the middle step adds %q", a.Key, a.Steps[2])
		}
		for i, s := range a.Steps {
			if i != 2 && strings.TrimSpace(s) == "" {
				t.Errorf("%s: step %d adds no text", a.Key, i+1)
			}
		}
		if a.Low == "" || a.High == "" {
			t.Errorf("%s: labels %q %q", a.Key, a.Low, a.High)
		}
	}
	if strings.Join(keys, ",") != "terse,cautious,formal" {
		t.Errorf("keys %v", keys)
	}
}

func TestMateToneSentences(t *testing.T) {
	axes := MateToneAxes()
	cases := []struct {
		name string
		tone MateTone
		want []string
	}{
		{"no tone adds nothing", MateTone{}, nil},
		{"middle steps add nothing", MateTone{Terse: 3, Cautious: 3, Formal: 3}, nil},
		{"one axis", MateTone{Terse: 1}, []string{axes[0].Steps[0]}},
		{"all axes in order", MateTone{Terse: 5, Cautious: 2, Formal: 4}, []string{axes[0].Steps[4], axes[1].Steps[1], axes[2].Steps[3]}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := MateToneSentences(tc.tone)
			if strings.Join(got, "|") != strings.Join(tc.want, "|") {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMateSystemPromptPutsTheToneBetweenThePromptAndTheMemory(t *testing.T) {
	m := Mate{Name: "a", Prompt: "PROMPT", Tone: MateTone{Terse: 1}}
	got := MateSystemPrompt(m, "NOTE", "/m.md")
	tone := MateToneAxes()[0].Steps[0]
	p, s, n := strings.Index(got, "PROMPT"), strings.Index(got, tone), strings.Index(got, "NOTE")
	if p < 0 || s < 0 || n < 0 || p >= s || s >= n {
		t.Errorf("order prompt %d tone %d memory %d:\n%s", p, s, n, got)
	}
}

func TestMateSystemPromptWithNoMemoryLeavesTheMemoryOut(t *testing.T) {
	m := Mate{Name: "a", Prompt: "PROMPT", NoMemory: true}
	got := MateSystemPrompt(m, "NOTE", "/m.md")
	if strings.Contains(got, "NOTE") || strings.Contains(got, "/m.md") || !strings.HasPrefix(got, "PROMPT") {
		t.Errorf("got:\n%s", got)
	}
}

func TestValidateMateTone(t *testing.T) {
	for _, tc := range []struct {
		tone MateTone
		ok   bool
	}{
		{MateTone{}, true},
		{MateTone{Terse: 1, Cautious: 5, Formal: 3}, true},
		{MateTone{Terse: 6}, false},
		{MateTone{Cautious: -1}, false},
		{MateTone{Formal: 9}, false},
	} {
		m := validMate()
		m.Tone = tc.tone
		err := ValidateMate(m, mateWorkspaces)
		if (err == nil) != tc.ok || (err != nil && !strings.Contains(err.Error(), "tone")) {
			t.Errorf("%+v: %v", tc.tone, err)
		}
	}
}

func TestMateTOMLWritesTheToneAndNoMemory(t *testing.T) {
	m := Mate{Name: "a", Prompt: "p", Agent: "claude", Enabled: true, Tone: MateTone{Terse: 2, Formal: 4}, NoMemory: true}
	got := MateTOML(m)
	if !strings.Contains(got, "tone = { terse = 2, formal = 4 }\n") || !strings.Contains(got, "no_memory = true\n") {
		t.Errorf("got:\n%s", got)
	}
	if got := MateTOML(Mate{Name: "a", Prompt: "p", Agent: "claude", Enabled: true}); strings.Contains(got, "tone") || strings.Contains(got, "no_memory") {
		t.Errorf("an unset tone writes nothing:\n%s", got)
	}
}
