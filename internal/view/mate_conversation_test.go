package view_test

import (
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/view"
)

func localMateFixture() rpc.State {
	seat := &domain.MateSeat{Name: "iris", Local: true}
	return rpc.State{
		Seq:        3,
		Workspaces: []domain.Workspace{{Root: "/w/api"}},
		Tasks:      []domain.Task{{ID: "t1", Source: domain.TaskText, Text: "review login"}, {ID: "t2", Source: domain.TaskText, Text: "old talk"}, {ID: "t3", Source: domain.TaskText, Text: "plain"}},
		Sessions: []domain.Session{
			{ID: "old", TaskID: "t2", Harness: domain.HarnessClaude, State: domain.StateIdle, Ended: true, StartedAt: t0, Mate: seat},
			{ID: "new", TaskID: "t1", Harness: domain.HarnessClaude, State: domain.StateRunning, StartedAt: t0.Add(time.Hour), Mate: seat},
			{ID: "plain", TaskID: "t3", Harness: domain.HarnessClaude, State: domain.StateRunning, StartedAt: t0},
			{ID: "slack", TaskID: "t3", Harness: domain.HarnessClaude, State: domain.StateRunning, StartedAt: t0, Mate: &domain.MateSeat{Name: "iris"}},
		},
		Mates: domain.MateBoard{Mates: []domain.MateStatus{
			{Name: "iris", State: domain.MateReady, Avatar: "iris", Color: "#cba6f7"},
			{Name: "bolt", State: domain.MateReady},
		}},
	}
}

func TestViewMatesListTheLocalConversationsNewestFirst(t *testing.T) {
	_, state := view.NewNative(localMateFixture())
	iris := state.Mates.Mates[0]
	if iris.Name != "iris" || iris.Avatar != "iris" || iris.Color != "#cba6f7" {
		t.Fatalf("iris %+v", iris.MateStatus)
	}
	if len(iris.Conversations) != 2 {
		t.Fatalf("conversations %+v", iris.Conversations)
	}
	first, second := iris.Conversations[0], iris.Conversations[1]
	if first.Session != "new" || first.Name != "review login" || first.State != domain.StateRunning || first.Ended || !first.StartedAt.Equal(t0.Add(time.Hour)) {
		t.Errorf("first %+v", first)
	}
	if second.Session != "old" || !second.Ended {
		t.Errorf("second %+v", second)
	}
	if len(iris.Work) != 1 || iris.Work[0] != "new" {
		t.Errorf("work %v", iris.Work)
	}
	if bolt := state.Mates.Mates[1]; bolt.Conversations == nil || len(bolt.Conversations) != 0 {
		t.Errorf("bolt %+v", bolt.Conversations)
	}
}

func TestViewMatesChangeWhenALocalConversationStarts(t *testing.T) {
	v, _ := view.NewNative(localMateFixture())
	s := domain.Session{ID: "third", TaskID: "t1", Harness: domain.HarnessClaude, State: domain.StateIdle, StartedAt: t0.Add(2 * time.Hour), Mate: &domain.MateSeat{Name: "bolt", Local: true}}
	var mates *view.Mates
	for _, d := range v.ApplyNative(rpc.Diff{Seq: 4, Session: &s}) {
		if d.Mates != nil {
			mates = d.Mates
		}
	}
	if mates == nil || len(mates.Mates[1].Conversations) != 1 || mates.Mates[1].Conversations[0].Session != "third" {
		t.Fatalf("mates %+v", mates)
	}
}
