package domain

import (
	"slices"
	"testing"
)

func TestMateFacesAreTheTwelveDesignFaces(t *testing.T) {
	var ids []string
	for _, f := range MateFaces {
		ids = append(ids, f.ID)
	}
	want := []string{"pip", "bolt", "sage", "visor", "iris", "owl", "dash", "wink", "prism", "moss", "beacon", "quill"}
	if !slices.Equal(ids, want) {
		t.Fatalf("faces %v", ids)
	}
}

func TestFaceOfPicksTheAvatarThenTheNameThenAHash(t *testing.T) {
	cases := []struct {
		name string
		mate Mate
		want string
	}{
		{"avatar", Mate{Name: "helper", Avatar: "owl"}, "owl"},
		{"unknown avatar falls to the name", Mate{Name: "bolt", Avatar: "nope"}, "bolt"},
		{"name is a face", Mate{Name: "sage"}, "sage"},
		{"hash of the name", Mate{Name: "a"}, MateFaces[97%12].ID},
		{"hash of a longer name", Mate{Name: "helper"}, MateFaces[(104+101+108+112+101+114)%12].ID},
	}
	for _, c := range cases {
		if got := FaceOf(c.mate).ID; got != c.want {
			t.Errorf("%s: face %q, want %q", c.name, got, c.want)
		}
	}
}

func TestFaceColorIsTheMateColorOrTheAccentOfTheFace(t *testing.T) {
	if got := FaceColor(Mate{Name: "pip", Color: "#123456"}); got != "#123456" {
		t.Errorf("color %q", got)
	}
	if got := FaceColor(Mate{Name: "pip"}); got != "#7287fd" {
		t.Errorf("accent %q", got)
	}
}

func TestFaceGlyphMarksTheState(t *testing.T) {
	pip := MateFaces[0]
	cases := []struct {
		st   FaceState
		want [2]string
	}{
		{FaceIdle, [2]string{"[● ●]", "[ ‿ ]"}},
		{FaceWorking, [2]string{"[● ●]", "[ ‿ ] ⠋"}},
		{FaceNeeds, [2]string{"[● ●] !", "[ o ]"}},
		{FacePaused, [2]string{"[─ ─]", "[ ─ ]"}},
		{FaceThinking, [2]string{"[˙ ˙]", "[ ─ ] …"}},
	}
	for _, c := range cases {
		if got := FaceGlyph(pip, c.st); got != c.want {
			t.Errorf("%s: %q, want %q", c.st, got, c.want)
		}
	}
	prism := FaceOf(Mate{Name: "prism"})
	if got := FaceGlyph(prism, FacePaused); got != [2]string{"<─ ─>", "< ─ >"} {
		t.Errorf("prism paused %q", got)
	}
}

func TestMateFaceStateOrdersPausedThenNeedsThenWorking(t *testing.T) {
	cases := []struct {
		name      string
		st        MateStatus
		approvals int
		sessions  []AgentState
		want      FaceState
	}{
		{"nothing runs", MateStatus{State: MateReady}, 0, nil, FaceIdle},
		{"idle and done sessions", MateStatus{State: MateReady}, 0, []AgentState{StateIdle, StateDone}, FaceIdle},
		{"a running session", MateStatus{State: MateReady}, 0, []AgentState{StateIdle, StateRunning}, FaceWorking},
		{"a waiting session", MateStatus{State: MateReady}, 0, []AgentState{StateRunning, StateWaiting}, FaceNeeds},
		{"a permission session", MateStatus{State: MateReady}, 0, []AgentState{StatePermission}, FaceNeeds},
		{"an approval", MateStatus{State: MateConnected}, 1, []AgentState{StateRunning}, FaceNeeds},
		{"paused", MateStatus{State: MatePaused}, 1, []AgentState{StateRunning}, FacePaused},
		{"a guard", MateStatus{State: MateConnected, Guard: GuardRate}, 0, []AgentState{StateRunning}, FacePaused},
	}
	for _, c := range cases {
		if got := MateFaceState(c.st, c.approvals, c.sessions); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

func TestToneSentencesAddOneSentenceForEachStepThatIsNotTheMiddle(t *testing.T) {
	if got := ToneSentences([]int{2, 2, 2}); len(got) != 0 {
		t.Fatalf("middle steps add %q", got)
	}
	got := ToneSentences([]int{1, 1, 4})
	want := []string{"Keep answers short. Use lists, not paragraphs.", "Ask before you run a command that changes files or pushes.", "Be playful and use humor."}
	if !slices.Equal(got, want) {
		t.Fatalf("sentences %q", got)
	}
	got = ToneSentences([]int{0, 3, 0})
	want = []string{"Answer in as few words as you can.", "Make reasonable choices without asking.", "Use a formal, professional tone."}
	if !slices.Equal(got, want) {
		t.Fatalf("sentences %q", got)
	}
	got = ToneSentences([]int{3, 0, 1})
	want = []string{"Explain your steps as you work.", "Ask before each change that is not small.", "Keep a calm, neutral tone."}
	if !slices.Equal(got, want) {
		t.Fatalf("sentences %q", got)
	}
	got = ToneSentences([]int{4, 4, 3})
	want = []string{"Talk freely and think out loud.", "Act on your own judgment and move fast.", "Use a friendly, relaxed tone."}
	if !slices.Equal(got, want) {
		t.Fatalf("sentences %q", got)
	}
	if got := ToneSentences([]int{5, -1, 2, 0}); len(got) != 0 {
		t.Fatalf("out of range steps add %q", got)
	}
}

func TestWithToneAppendsTheSentencesAfterABlankLine(t *testing.T) {
	if got := WithTone("Review code.", []int{2, 2, 2}); got != "Review code." {
		t.Errorf("no tone %q", got)
	}
	if got := WithTone("Review code.\n", []int{1, 2, 4}); got != "Review code.\n\nKeep answers short. Use lists, not paragraphs. Be playful and use humor." {
		t.Errorf("tone %q", got)
	}
}
