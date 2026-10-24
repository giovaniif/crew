package daemon_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func mentionIn(channel, user, text, ts string) app.SlackEvent {
	return app.SlackEvent{Kind: app.SlackMention, Team: "T0TEAM001", Channel: channel, User: user, Text: text, TS: ts, ThreadTS: ts}
}

func TestMateMentionsInTwoSlackThreadsGoToTheOneConversation(t *testing.T) {
	r := startMateRig(t, &memStore{})
	m := r.connect(t, "helper")
	r.hub.send(m, mention(mateGuest, "<@U0BOT0001> look at login", "1700.0001"))
	waitFor(t, func() bool { return len(r.mateSessions(t)) == 1 && len(r.store.mateThreads()) == 1 })
	r.hub.send(m, mentionIn("C0CHAN002", mateOwner, "<@U0BOT0001> look at search", "1700.0002"))
	waitFor(t, func() bool { return len(r.store.mateThreads()) == 2 })
	sessions := r.mateSessions(t)
	if len(sessions) != 1 {
		t.Fatalf("sessions %+v", sessions)
	}
	for _, l := range r.store.mateThreads() {
		if l.SessionID != sessions[0].ID {
			t.Errorf("link %+v goes to a different session", l)
		}
	}
	texts := queuedTexts(t, r.c)
	if len(texts) != 2 || !strings.Contains(texts[1], "[Source: #C0CHAN002]") || !strings.Contains(texts[1], "look at search") {
		t.Fatalf("queued %q", texts)
	}
}

func TestMateDirectMessageGoesToTheConversationAndTheAnswerToTheDM(t *testing.T) {
	r := startMateRig(t, &memStore{})
	m := r.connect(t, "helper")
	r.hub.send(m, app.SlackEvent{Kind: app.SlackDirectMessage, Team: "T0TEAM001", Channel: "D0DM00001", User: mateGuest, Text: "hi, check the build", TS: "1700.0003"})
	waitFor(t, func() bool { return len(r.mateSessions(t)) == 1 })
	texts := queuedTexts(t, r.c)
	if len(texts) != 1 || !strings.Contains(texts[0], "[Source: DM]") {
		t.Fatalf("queued %q", texts)
	}
	hookMatePane(t, r.c, "UserPromptSubmit", `{"prompt":"x"}`)
	hookMatePane(t, r.c, "Stop", `{"last_assistant_message":"The build is green."}`)
	waitFor(t, func() bool {
		for _, p := range r.posts() {
			if p.channel == "D0DM00001" && p.text == "The build is green." {
				return true
			}
		}
		return false
	})
}

func TestMateConversationAnswersInTheThreadOfEachTurnInOrder(t *testing.T) {
	r := startMateRig(t, &memStore{})
	m := r.connect(t, "helper")
	r.hub.send(m, mention(mateGuest, "<@U0BOT0001> first ask", "1700.0001"))
	waitFor(t, func() bool { return len(r.store.mateThreads()) == 1 })
	r.hub.send(m, mentionIn("C0CHAN002", mateGuest, "<@U0BOT0001> second ask", "1700.0002"))
	waitFor(t, func() bool { return len(r.store.mateThreads()) == 2 })
	hookMatePane(t, r.c, "SessionStart", `{}`)
	waitFor(t, func() bool { return r.typed("first ask") && r.entered(1) })
	time.Sleep(20 * time.Millisecond)
	hookMatePane(t, r.c, "UserPromptSubmit", `{"prompt":"x"}`)
	hookMatePane(t, r.c, "Stop", `{"last_assistant_message":"Answer one."}`)
	waitFor(t, func() bool { return r.typed("second ask") })
	time.Sleep(20 * time.Millisecond)
	hookMatePane(t, r.c, "UserPromptSubmit", `{"prompt":"x"}`)
	hookMatePane(t, r.c, "Stop", `{"last_assistant_message":"Answer two."}`)
	want := map[string]string{"Answer one.": "C0CHAN001/1700.0001", "Answer two.": "C0CHAN002/1700.0002"}
	waitFor(t, func() bool {
		got := 0
		for _, p := range r.posts() {
			if w, ok := want[p.text]; ok {
				if w != p.channel+"/"+p.thread {
					t.Fatalf("%q went to %s/%s, want %s", p.text, p.channel, p.thread, w)
				}
				got++
			}
		}
		return got == 2
	})
}

func TestMateNewTwiceSendsIntoTheOneConversation(t *testing.T) {
	r, _ := localRig(t)
	var first, second domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "fix the login bug"}, &first); err != nil {
		t.Fatal(err)
	}
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "and the docs"}, &second); err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("second input started %s, want the conversation %s", second.ID, first.ID)
	}
	if texts := queuedTexts(t, r.c); len(texts) != 2 || texts[1] != "and the docs" {
		t.Fatalf("queued %q", texts)
	}
}

func TestMateSlackTurnInAnAppConversationGoesThroughTheGate(t *testing.T) {
	r := startMateRig(t, &memStore{})
	m := r.connect(t, "helper")
	var conv domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "app ask"}, &conv); err != nil {
		t.Fatal(err)
	}
	r.hub.send(m, mention(mateGuest, "<@U0BOT0001> slack ask", "1700.0001"))
	waitFor(t, func() bool { return len(queuedTexts(t, r.c)) == 2 })
	hookMatePane(t, r.c, "UserPromptSubmit", `{"prompt":"x"}`)
	hookMatePane(t, r.c, "Stop", `{"last_assistant_message":"ok"}`)
	waitFor(t, func() bool { return r.typed("app ask") && r.entered(1) })
	time.Sleep(20 * time.Millisecond)
	hookMatePane(t, r.c, "UserPromptSubmit", `{"prompt":"x"}`)
	hookMatePane(t, r.c, "Stop", `{"last_assistant_message":"ok"}`)
	waitFor(t, func() bool {
		s := r.mateSessions(t)
		return len(s) == 1 && s[0].ID == conv.ID && !s[0].Mate.Local && s[0].Mate.Authority == mateGuest
	})
}

func TestMateResetEndsTheConversationAsHistoryAndTheNextInputStartsANewOne(t *testing.T) {
	r, _ := localRig(t)
	var first domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "old work"}, &first); err != nil {
		t.Fatal(err)
	}
	if err := r.c.Call(context.Background(), rpc.MethodMateReset, rpc.MateNameParams{Name: "helper"}, nil); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		for _, s := range r.mateSessions(t) {
			if s.ID == first.ID {
				return s.Ended && s.Mate.History
			}
		}
		return false
	})
	var next domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "new work"}, &next); err != nil {
		t.Fatal(err)
	}
	if next.ID == first.ID {
		t.Fatal("the input after a reset went to the old conversation")
	}
}

func TestMateResetOfAnUnknownMateIsNotFound(t *testing.T) {
	r, _ := localRig(t)
	err := r.c.Call(context.Background(), rpc.MethodMateReset, rpc.MateNameParams{Name: "nobody"}, nil)
	var re *rpc.Error
	if !errors.As(err, &re) || re.Code != rpc.CodeNotFound {
		t.Fatalf("err %v", err)
	}
}

const conversationAutomation = localMates + `
[[automation]]
name = "weekly"
mate = "helper"
prompt = "TEST check the deps"
`

func TestAutomationOfAMateAppendsToTheConversationEachRun(t *testing.T) {
	r := startMateRigWith(t, &memStore{}, conversationAutomation)
	var conv domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "app ask"}, &conv); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		got := runMateAutomation(t, r, "weekly")
		if got.Run.Outcome != domain.AutomationSucceeded || got.Session.ID != conv.ID {
			t.Fatalf("run %+v in session %s, want the conversation %s", got.Run, got.Session.ID, conv.ID)
		}
	}
	texts := queuedTexts(t, r.c)
	if len(texts) != 3 || !strings.HasPrefix(texts[2], "[Source: Automation weekly]") {
		t.Fatalf("queued %q", texts)
	}
}

func TestMateWithSeveralOldThreadsUsesTheNewestAsTheConversation(t *testing.T) {
	store := &memStore{}
	at := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	store.snap.Sessions = []domain.Session{
		{ID: "s1", Harness: domain.HarnessClaude, Pane: "%5", State: domain.StateIdle, StartedAt: at, Mate: &domain.MateSeat{Name: "helper", Owner: mateOwner}},
		{ID: "s2", Harness: domain.HarnessClaude, Pane: "%6", State: domain.StateIdle, StartedAt: at.Add(time.Hour), Mate: &domain.MateSeat{Name: "helper", Owner: mateOwner}},
	}
	r := startMateRig(t, store)
	var got domain.Session
	if err := r.c.Call(context.Background(), rpc.MethodMateNew, rpc.MateNewParams{Name: "helper", Prompt: "go on"}, &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != "s2" {
		t.Fatalf("input went to %s, want the newest s2", got.ID)
	}
}
