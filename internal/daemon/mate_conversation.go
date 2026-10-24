package daemon

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

type mateStarter func(prompt string, in *domain.MateInput) (domain.Session, *rpc.Error, bool)

func (s *state) mateTurnStarts(sessionID string, in domain.MateInput) {
	cur, ok := s.sessions[sessionID]
	if !ok || cur.Mate == nil {
		return
	}
	seat := domain.MateTurnSeat(*cur.Mate, in.Seat)
	cur.Mate = &seat
	s.emit(SessionChanged{Session: cur})
	if in.Reply.Channel != "" {
		s.mateReply[sessionID] = in.Reply
	} else {
		delete(s.mateReply, sessionID)
	}
}

func (s *state) noteMateAsk(sessionID string, in *domain.MateInput) {
	cur, ok := s.sessions[sessionID]
	if in == nil || !ok || cur.Mate == nil {
		return
	}
	s.mateAsked[sessionID] = domain.MateTurnSeat(*cur.Mate, in.Seat)
}

func (s *state) mateAskedSeat(sessionID string) (domain.MateSeat, bool) {
	if seat, ok := s.mateAsked[sessionID]; ok {
		return seat, true
	}
	if cur, ok := s.sessions[sessionID]; ok && cur.Mate != nil {
		return *cur.Mate, true
	}
	return domain.MateSeat{}, false
}

func (d *Daemon) mateConversation(name string) (domain.Session, bool, bool) {
	var conv domain.Session
	var found bool
	ok := d.query(func(s *state) { conv, found = domain.MateConversation(s.sessionList(), name) })
	return conv, found, ok
}

func (d *Daemon) mateDeliver(name, text string, in domain.MateInput, start mateStarter) (domain.Session, *rpc.Error, bool) {
	conv, found, ok := d.mateConversation(name)
	if !ok {
		return domain.Session{}, nil, false
	}
	if found && conv.Ended {
		resp, ok := d.resumeSession(rpc.Request{Method: rpc.MethodResumeSession, Params: mustJSON(rpc.SessionRef{ID: conv.ID})})
		if !ok {
			return domain.Session{}, nil, false
		}
		found = resp.Error == nil
	}
	if !found {
		return start(text, &in)
	}
	resp, ok := d.queueSend(0, conv.ID, text, &in)
	switch {
	case !ok:
		return domain.Session{}, nil, false
	case resp.Error != nil:
		return domain.Session{}, resp.Error, true
	}
	ok = d.query(func(s *state) { conv = s.sessions[conv.ID] })
	return conv, nil, ok
}

func (d *Daemon) mateReset(req rpc.Request) (*rpc.Response, bool) {
	var p rpc.MateNameParams
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, "mate.reset needs a name"), true
	}
	if _, _, ok := d.findMate(p.Name); !ok {
		return errorResponse(req.ID, rpc.CodeNotFound, fmt.Sprintf("no mate %q", p.Name)), true
	}
	conv, found, ok := d.mateConversation(p.Name)
	if !ok {
		return nil, false
	}
	if !found {
		return result(req.ID, struct{}{}), true
	}
	if !d.retireMateSession(conv.ID) {
		return nil, false
	}
	if conv.Ended {
		return result(req.ID, struct{}{}), true
	}
	if _, ok, err := d.endAndRefill(conv); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error()), true
	} else if !ok {
		return nil, false
	}
	return result(req.ID, struct{}{}), true
}

func (d *Daemon) retireMateSession(id string) bool {
	return d.query(func(s *state) {
		cur, ok := s.sessions[id]
		if !ok || cur.Mate == nil {
			return
		}
		seat := *cur.Mate
		seat.History = true
		cur.Mate = &seat
		s.emit(SessionChanged{Session: cur})
		delete(s.mateReply, id)
	})
}
