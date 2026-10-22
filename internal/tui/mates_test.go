package tui_test

import (
	"errors"
	"slices"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/exp/golden"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/tui"
)

func withMates(st rpc.State) rpc.State {
	st.Mates = domain.MateBoard{Mates: []domain.MateStatus{
		{Name: "helper", State: domain.MateConnected},
		{Name: "webby", State: domain.MatePaused},
	}}
	st.MateThreads = []domain.MateLink{{Mate: "helper", Team: "T1", Channel: "C1", ThreadTS: "1700.0001", SessionID: st.Sessions[0].ID}}
	return st
}

func withLocalMates(st rpc.State) rpc.State {
	st = withMates(st)
	st.MateThreads = nil
	st.Sessions[0].Mate = &domain.MateSeat{Name: "helper", Local: true}
	return st
}

var testMates = []domain.Mate{
	{Name: "helper", Prompt: "Careful reviewer. Asks before it merges.", Agent: "claude", Model: "opus", Effort: "high", Repos: []string{"api"}, Avatar: "pip", Enabled: true},
	{Name: "webby", Prompt: "Fast fixer.", Agent: "codex", Avatar: "bolt", Enabled: true},
}

func testTones() []domain.MateToneAxis {
	axes := domain.MateToneAxes()
	axes[2].Steps[4] = "Joke a lot."
	return axes
}

func matesModel(t *testing.T, st rpc.State) (tui.Model, *fakeCaller) {
	t.Helper()
	c := &fakeCaller{mates: testMates, tones: testTones(), memory: "- Owner wants small PRs.\n- Tests come first.\n", asks: []domain.Approval{{
		ID: "a1", SessionID: st.Sessions[0].ID, Mate: "helper", Requester: "Gus",
		Action: domain.Action{Kind: domain.ActionMerge, Tool: "Bash", Input: "gh pr merge 12"}, At: clock(), State: domain.ApprovalPending,
	}}}
	m := tui.New(tui.Options{Theme: tui.Latte(), Now: clock, Calls: c})
	m = update(m, tea.WindowSizeMsg{Width: 48, Height: 40})
	m = update(m, tui.StateMsg(st))
	return pressCmd(m, key("C")), c
}

func lastCall(c *fakeCaller) call {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls[len(c.calls)-1]
}

func TestGoldenMates(t *testing.T) {
	m, _ := matesModel(t, withMates(fixture(1, 0)))
	golden.RequireEqual(t, screen(m))
}

func TestMatesViewShowsEachMateItsThreadsAndThePendingApprovals(t *testing.T) {
	m, c := matesModel(t, withMates(fixture(1, 0)))
	out := screen(m)
	for _, want := range []string{"MATES", "helper", "connected", "webby", "paused", "NEEDS YOU", "helper: merge", "Gus", "gh pr merge 12"} {
		if want == "gh pr merge 12" {
			m = press(m, "j", "j")
			out = screen(m)
		}
		if !strings.Contains(out, want) {
			t.Fatalf("mates view lacks %q:\n%s", want, out)
		}
	}
	if got := c.methods(); !slices.Equal(got, []string{rpc.MethodApprovalList, rpc.MethodMateList}) {
		t.Fatalf("calls %v", got)
	}
}

func TestMatesViewPausesAndResumesTheSelectedMate(t *testing.T) {
	m, c := matesModel(t, withMates(fixture(1, 0)))
	m = pressCmd(m, key("p"))
	if got := lastCall(c); got.method != rpc.MethodMatePause || got.params != (rpc.MateNameParams{Name: "helper"}) {
		t.Fatalf("call %+v", got)
	}
	m = press(m, "j")
	pressCmd(m, key("p"))
	if got := lastCall(c); got.method != rpc.MethodMateResume || got.params != (rpc.MateNameParams{Name: "webby"}) {
		t.Fatalf("call %+v", got)
	}
}

func TestMatesKillSwitchAsksThenStopsAllMates(t *testing.T) {
	m, c := matesModel(t, withMates(fixture(1, 0)))
	m = pressCmd(m, key("X"))
	if !strings.Contains(screen(m), "stop all mates? y/n") {
		t.Fatalf("no confirm:\n%s", screen(m))
	}
	pressCmd(m, key("y"))
	if got := lastCall(c); got.method != rpc.MethodMateStopAll || got.params != (rpc.MateStopAllParams{Stop: true}) {
		t.Fatalf("call %+v", got)
	}
}

func TestMatesKillSwitchShowsOnTheSidebarAndStartsAgainWithoutAConfirm(t *testing.T) {
	m, c := matesModel(t, withMates(fixture(1, 0)))
	m = update(m, tui.DiffMsg(rpc.Diff{Mates: &domain.MateBoard{Stopped: true, Mates: []domain.MateStatus{{Name: "helper", State: domain.MateConnected, Guard: domain.GuardStopped}}}}))
	if out := screen(m); !strings.Contains(out, "all mates are stopped") || !strings.Contains(out, "connected · stopped") {
		t.Fatalf("panel does not show the stop:\n%s", out)
	}
	m = pressCmd(m, key("X"))
	if got := lastCall(c); got.method != rpc.MethodMateStopAll || got.params != (rpc.MateStopAllParams{Stop: false}) {
		t.Fatalf("call %+v", got)
	}
	m = press(m, "esc")
	if out := screen(m); !strings.Contains(out, "all mates stopped") {
		t.Fatalf("sidebar does not show the stop:\n%s", out)
	}
}

func TestMatesViewApprovesAndDeniesTheSelectedApproval(t *testing.T) {
	for _, c := range []struct {
		key     string
		approve bool
	}{{"y", true}, {"n", false}} {
		m, f := matesModel(t, withMates(fixture(1, 0)))
		m = press(m, "j", "j")
		pressCmd(m, key(c.key))
		var decided []call
		f.mu.Lock()
		for _, x := range f.calls {
			if x.method == rpc.MethodApprovalDecide {
				decided = append(decided, x)
			}
		}
		f.mu.Unlock()
		if len(decided) != 1 || decided[0].params != (rpc.ApprovalDecideParams{ID: "a1", Approve: c.approve}) {
			t.Fatalf("%s: decided %+v", c.key, decided)
		}
		if got := f.methods(); got[len(got)-1] != rpc.MethodApprovalList {
			t.Fatalf("%s: approvals not loaded again: %v", c.key, got)
		}
	}
}

func TestMatesViewClosesWithEsc(t *testing.T) {
	m, _ := matesModel(t, withMates(fixture(1, 0)))
	m = press(m, "esc")
	if out := screen(m); strings.Contains(out, "NEEDS YOU") {
		t.Fatalf("still open:\n%s", out)
	}
}

func TestMatesViewLoadsTheApprovalsAgainAfterAFailedDecision(t *testing.T) {
	m, f := matesModel(t, withMates(fixture(1, 0)))
	f.err, f.failOn = errors.New("the approval expired"), rpc.MethodApprovalDecide
	m = press(m, "j", "j")
	m = pressCmd(m, key("y"))
	if got := f.methods(); got[len(got)-1] != rpc.MethodApprovalList {
		t.Fatalf("approvals not loaded again: %v", got)
	}
	if out := screen(m); !strings.Contains(out, "the approval expired") || !strings.Contains(out, "helper: merge") {
		t.Fatalf("panel:\n%s", out)
	}
}

func callsOf(c *fakeCaller, method string) []call {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []call
	for _, x := range c.calls {
		if x.method == method {
			out = append(out, x)
		}
	}
	return out
}

func ctrl(r rune) tea.KeyPressMsg { return tea.KeyPressMsg{Code: r, Mod: tea.ModCtrl} }

func TestGoldenMateDetail(t *testing.T) {
	m, _ := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("enter"))
	golden.RequireEqual(t, screen(m))
}

func TestGoldenNewMate(t *testing.T) {
	m, _ := matesModel(t, withLocalMates(fixture(1, 0)))
	m = press(m, "a")
	golden.RequireEqual(t, screen(m))
}

func TestMatesPageShowsEachMateWithItsFaceAndState(t *testing.T) {
	m, _ := matesModel(t, withLocalMates(fixture(1, 0)))
	out := screen(m)
	for _, want := range []string{"[● ●] !", "[ o ]", "helper", "needs you", "[─ ─]", "webby", "paused", "Careful reviewer.", "NEEDS YOU"} {
		if !strings.Contains(out, want) {
			t.Fatalf("mates page lacks %q:\n%s", want, out)
		}
	}
}

func TestMatesPageStartsANewConversationWithTheSelectedMate(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("c"))
	got := callsOf(c, rpc.MethodMateNew)
	if len(got) != 1 || got[0].params != (rpc.MateNewParams{Name: "helper"}) {
		t.Fatalf("mate.new calls %+v", got)
	}
	if f := callsOf(c, rpc.MethodSessionFocus); len(f) != 1 || f[0].params != (rpc.SessionFocusParams{ID: "m1"}) {
		t.Fatalf("focus calls %+v", f)
	}
	if strings.Contains(screen(m), "NEEDS YOU") {
		t.Fatalf("page still open:\n%s", screen(m))
	}
}

func TestMateDetailShowsTheConversationsAndTheMemory(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("enter"))
	out := screen(m)
	for _, want := range []string{"helper", "Careful reviewer.", "claude · opus · high", "api", "slack", "CONVERSATIONS", "task number 1", "MEMORY", "- Owner wants small PRs.", "- Tests come first."} {
		if !strings.Contains(out, want) {
			t.Fatalf("detail lacks %q:\n%s", want, out)
		}
	}
	if got := callsOf(c, rpc.MethodMateMemory); len(got) != 1 || got[0].params != (rpc.MateNameParams{Name: "helper"}) {
		t.Fatalf("memory calls %+v", got)
	}
	m = press(m, "esc")
	if !strings.Contains(screen(m), "NEEDS YOU") {
		t.Fatalf("esc does not go back to the page:\n%s", screen(m))
	}
}

func TestMateDetailStartFreshCallsMateFreshInTheSameWorktree(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("enter"))
	pressCmd(m, key("f"))
	if got := callsOf(c, rpc.MethodMateFresh); len(got) != 1 || got[0].params != (rpc.MateFreshParams{Session: "s01", SameWorktree: true}) {
		t.Fatalf("fresh calls %+v", got)
	}
	if got := callsOf(c, rpc.MethodSessionSend); len(got) != 0 {
		t.Fatalf("the tui sent the handoff itself: %+v", got)
	}
	methods := c.methods()
	if methods[len(methods)-1] != rpc.MethodSessionFocus {
		t.Fatalf("calls %v", methods)
	}
}

func TestMateDetailShiftFStartsFreshInANewWorktree(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("enter"))
	pressCmd(m, key("F"))
	if got := callsOf(c, rpc.MethodMateFresh); len(got) != 1 || got[0].params != (rpc.MateFreshParams{Session: "s01"}) {
		t.Fatalf("fresh calls %+v", got)
	}
}

func TestMateDetailEditsTheMemory(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = pressCmd(m, key("enter"))
	m = press(m, "m")
	m = typeText(m, "- Never force-push main.\n")
	m = pressCmd(m, ctrl('s'))
	got := callsOf(c, rpc.MethodMateSetMemory)
	want := rpc.MateSetMemoryParams{Name: "helper", Text: "- Owner wants small PRs.\n- Tests come first.\n- Never force-push main.\n"}
	if len(got) != 1 || got[0].params != want {
		t.Fatalf("set_memory calls %+v", got)
	}
	if !strings.Contains(screen(m), "- Never force-push main.") || strings.Contains(screen(m), "ctrl+s save") {
		t.Fatalf("detail after save:\n%s", screen(m))
	}
}

func TestNewMateFlowMakesAMateFromTheFaceThePersonalityAndTheBrains(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	m = press(m, "a", "right", "right")
	m = typeText(m, "quill")
	if out := screen(m); !strings.Contains(out, "1 face") || !strings.Contains(out, "(^ ^)") || !strings.Contains(out, "quill") {
		t.Fatalf("step 1:\n%s", out)
	}
	m = update(m, ctrl('n'))
	m = typeText(m, "Pair programmer.")
	m = press(m, "tab", "left", "tab", "tab", "right", "right")
	out := screen(m)
	for _, want := range []string{"2 personality", "Terse", "Chatty", "2/5", "5/5", "Added to the prompt", "Keep answers short. Use lists, not paragraphs.", "Joke a lot.", "Middle step. Adds no text."} {
		if !strings.Contains(out, want) {
			t.Fatalf("step 2 lacks %q:\n%s", want, out)
		}
	}
	m = update(m, ctrl('n'))
	m = press(m, "right", "tab", "tab")
	m = typeText(m, "api")
	if out := screen(m); !strings.Contains(out, "3 brains") || !strings.Contains(out, "codex") {
		t.Fatalf("step 3:\n%s", out)
	}
	m = pressCmd(m, key("enter"))
	got := callsOf(c, rpc.MethodMateSet)
	if len(got) != 1 {
		t.Fatalf("mate.set calls %+v", got)
	}
	mt := got[0].params.(rpc.MateSetParams).Mate
	if mt.Name != "quill" || mt.Avatar != "sage" || mt.Agent != "codex" || !mt.Enabled || !slices.Equal(mt.Repos, []string{"api"}) ||
		mt.Prompt != "Pair programmer." || mt.Tone != (domain.MateTone{Terse: 2, Cautious: 3, Formal: 5}) {
		t.Fatalf("mate %+v", mt)
	}
	if !strings.Contains(screen(m), "NEEDS YOU") {
		t.Fatalf("flow does not go back to the page:\n%s", screen(m))
	}
}

func TestNewMateFlowShowsARefusalAndStaysOpen(t *testing.T) {
	m, c := matesModel(t, withLocalMates(fixture(1, 0)))
	c.err, c.failOn = errors.New(`mate "quill": prompt is empty`), rpc.MethodMateSet
	m = press(m, "a")
	m = typeText(m, "quill")
	m = update(m, ctrl('n'))
	m = update(m, ctrl('n'))
	m = pressCmd(m, key("enter"))
	if out := screen(m); !strings.Contains(out, "prompt is empty") || !strings.Contains(out, "3 brains") {
		t.Fatalf("refusal:\n%s", out)
	}
	m = update(m, ctrl('p'))
	if out := screen(m); !strings.Contains(out, "Added to the prompt") {
		t.Fatalf("ctrl+p does not go back:\n%s", out)
	}
	m = press(m, "esc")
	if !strings.Contains(screen(m), "NEEDS YOU") {
		t.Fatalf("esc does not cancel:\n%s", screen(m))
	}
}

func TestNewMateFlowRefusesATakenOrBadNameAtTheFaceStep(t *testing.T) {
	cases := []struct{ name, want string }{
		{"helper", "A mate named helper exists."},
		{"no way", "Use up to 32 letters, digits, - and _."},
	}
	for _, tc := range cases {
		for _, next := range []tea.KeyPressMsg{key("enter"), ctrl('n')} {
			m, c := matesModel(t, withLocalMates(fixture(1, 0)))
			m = press(m, "a")
			m = typeText(m, tc.name)
			m = pressCmd(m, next)
			out := screen(m)
			if !strings.Contains(out, tc.want) || !strings.Contains(out, "1 face") || strings.Contains(out, "Added to the prompt") {
				t.Errorf("%q with %s:\n%s", tc.name, next.String(), out)
			}
			if got := callsOf(c, rpc.MethodMateSet); len(got) != 0 {
				t.Errorf("mate.set calls %+v", got)
			}
		}
	}
}

func TestNewMateFlowTakesShiftedLetters(t *testing.T) {
	m, _ := matesModel(t, withLocalMates(fixture(1, 0)))
	m = press(m, "a")
	m = update(m, tea.KeyPressMsg{Code: 'q', ShiftedCode: 'Q', Text: "Q", Mod: tea.ModShift})
	if out := screen(m); !strings.Contains(out, "name   Q▏") {
		t.Fatalf("shifted letter lost:\n%s", out)
	}
}

func TestSidebarShowsMateFacesAndAMatesSection(t *testing.T) {
	c := &fakeCaller{mates: testMates}
	m := tui.New(tui.Options{Theme: tui.Latte(), Now: clock, Calls: c})
	m = update(m, tea.WindowSizeMsg{Width: 48, Height: 40})
	next, cmd := m.Update(tui.StateMsg(withLocalMates(fixture(2, 0))))
	m = run(next.(tui.Model), cmd)
	out := screen(m)
	for _, want := range []string{"[● ●]", "helper ·", "MATES", "1 live", "webby", "paused"} {
		if !strings.Contains(out, want) {
			t.Fatalf("sidebar lacks %q:\n%s", want, out)
		}
	}
}

func TestSidebarCStartsAConversationWithTheMateOfTheSelectedSession(t *testing.T) {
	c := &fakeCaller{mates: testMates}
	m := tui.New(tui.Options{Theme: tui.Latte(), Now: clock, Calls: c})
	m = update(m, tea.WindowSizeMsg{Width: 48, Height: 40})
	m = update(m, tui.StateMsg(withLocalMates(fixture(2, 0))))
	pressCmd(m, key("c"))
	if got := callsOf(c, rpc.MethodMateNew); len(got) != 1 || got[0].params != (rpc.MateNewParams{Name: "helper"}) {
		t.Fatalf("mate.new calls %+v", got)
	}
	m = press(m, "j")
	m = pressCmd(m, key("c"))
	if !strings.Contains(screen(m), "NEEDS YOU") {
		t.Fatalf("c on a session without a mate does not open the page:\n%s", screen(m))
	}
}
