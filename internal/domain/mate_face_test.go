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
