package domain

import (
	"testing"
	"time"
)

func TestMateConversationIsTheNewestSessionOfTheMateThatIsNotHistory(t *testing.T) {
	at := func(m int) time.Time { return time.Date(2026, 10, 23, 9, m, 0, 0, time.UTC) }
	seat := func(name string, history bool) *MateSeat { return &MateSeat{Name: name, History: history} }
	cases := []struct {
		name     string
		sessions []Session
		want     string
		ok       bool
	}{
		{"no session", nil, "", false},
		{"not a mate", []Session{{ID: "a", StartedAt: at(1)}}, "", false},
		{"other mate", []Session{{ID: "a", StartedAt: at(1), Mate: seat("bo", false)}}, "", false},
		{"one", []Session{{ID: "a", StartedAt: at(1), Mate: seat("ada", false)}}, "a", true},
		{"newest of several threads", []Session{
			{ID: "a", StartedAt: at(1), Mate: seat("ada", false)},
			{ID: "c", StartedAt: at(3), Mate: seat("ada", false), Ended: true},
			{ID: "b", StartedAt: at(2), Mate: seat("ada", false)},
		}, "c", true},
		{"history is skipped", []Session{
			{ID: "a", StartedAt: at(1), Mate: seat("ada", false)},
			{ID: "b", StartedAt: at(2), Mate: seat("ada", true)},
		}, "a", true},
		{"only history", []Session{{ID: "b", StartedAt: at(2), Mate: seat("ada", true)}}, "", false},
		{"same time picks the higher id", []Session{
			{ID: "a", StartedAt: at(1), Mate: seat("ada", false)},
			{ID: "b", StartedAt: at(1), Mate: seat("ada", false)},
		}, "b", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := MateConversation(c.sessions, "ada")
			if ok != c.ok || got.ID != c.want {
				t.Fatalf("got %q %v, want %q %v", got.ID, ok, c.want, c.ok)
			}
		})
	}
}

func TestMateTurnSeatTakesTheSeatOfTheInputAndKeepsTheMate(t *testing.T) {
	current := MateSeat{Name: "ada", Owner: "U1", Authority: "U1", Local: true, FreshFrom: "old"}
	cases := []struct {
		name string
		in   MateSeat
		want MateSeat
	}{
		{"slack turn turns the gate on", MateSeat{Name: "x", Owner: "x", Authority: "U2", Origin: "U2", Hops: 1, Asked: []ActionKind{"push"}},
			MateSeat{Name: "ada", Owner: "U1", Authority: "U2", Origin: "U2", Hops: 1, Asked: []ActionKind{"push"}, FreshFrom: "old"}},
		{"app turn acts as the owner", MateSeat{Local: true},
			MateSeat{Name: "ada", Owner: "U1", Authority: "U1", Local: true, FreshFrom: "old"}},
		{"automation turn names the automation", MateSeat{Local: true, Automation: "weekly"},
			MateSeat{Name: "ada", Owner: "U1", Authority: "U1", Local: true, Automation: "weekly", FreshFrom: "old"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := MateTurnSeat(current, c.in)
			if got.Name != c.want.Name || got.Owner != c.want.Owner || got.Authority != c.want.Authority || got.Origin != c.want.Origin ||
				got.Hops != c.want.Hops || got.Local != c.want.Local || got.Automation != c.want.Automation || got.FreshFrom != c.want.FreshFrom ||
				len(got.Asked) != len(c.want.Asked) || got.History {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestMateSourcePromptMarksWhereTheMessageCameFrom(t *testing.T) {
	cases := []struct {
		name string
		src  MateSource
		want string
	}{
		{"app", MateSource{}, "hi"},
		{"channel", MateSource{Channel: "C123"}, "[Source: #C123] hi"},
		{"dm", MateSource{Channel: "D123"}, "[Source: DM] hi"},
		{"automation", MateSource{Automation: "weekly"}, "[Source: Automation weekly] hi"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := MateSourcePrompt(c.src, "hi"); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
