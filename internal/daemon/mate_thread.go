package daemon

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const (
	mateSeenKept     = 512
	mateStatusEvery  = 5 * time.Second
	mateWorkItemMax  = 80
	mateStatusWorks  = "Working on it."
	mateStatusDone   = "Done."
	mateStatusFailed = "Stopped."
)

func (d *Daemon) firstSight(name string, e app.SlackEvent) bool {
	key := name + "\x00" + e.Channel + "\x00" + e.TS
	d.slack.mu.Lock()
	defer d.slack.mu.Unlock()
	for _, k := range d.slack.seen {
		if k == key {
			return false
		}
	}
	d.slack.seen = append(d.slack.seen, key)
	if len(d.slack.seen) > mateSeenKept {
		d.slack.seen = d.slack.seen[len(d.slack.seen)-mateSeenKept:]
	}
	return true
}

func (d *Daemon) findMate(name string) (domain.Mate, domain.MateLimits, bool) {
	if d.cfg.path == "" {
		return domain.Mate{}, domain.MateLimits{}, false
	}
	d.cfg.mu.Lock()
	src, err := readConfig(d.cfg.path)
	d.cfg.mu.Unlock()
	if err != nil {
		return domain.Mate{}, domain.MateLimits{}, false
	}
	list := d.loadMates(src)
	for _, m := range list.Mates {
		if m.Name == name {
			return m, list.Limits, true
		}
	}
	return domain.Mate{}, domain.MateLimits{}, false
}

func (d *Daemon) mateAuthor(name, user string) (string, string, bool) {
	d.slack.mu.Lock()
	defer d.slack.mu.Unlock()
	self := d.slack.users[name]
	for mate, u := range d.slack.users {
		if mate != name && u == user {
			return mate, self, true
		}
	}
	return "", self, false
}

func (d *Daemon) mateThreadEvent(ctx context.Context, name string, client app.SlackMate, e app.SlackEvent) {
	author, self, fromMate := d.mateAuthor(name, e.User)
	mentioned := e.Kind == app.SlackMention || e.Kind == app.SlackDirectMessage || domain.MateMentions(e.Text, self)
	if fromMate && !mentioned {
		return
	}
	m, limits, ok := d.findMate(name)
	if !ok {
		return
	}
	d.slack.threads.Lock()
	defer d.slack.threads.Unlock()
	key := domain.MateThreadKey(e.Team, e.Channel, e.ThreadTS, name)
	var link domain.MateThread
	var linked bool
	var seat domain.MateSeat
	var stop domain.MateGuardStop
	if !d.query(func(s *state) {
		var found bool
		link, found = s.mateThreads[key]
		conv, has := domain.MateConversation(s.sessionList(), name)
		linked = found && has && conv.ID == link.SessionID
		if !linked && !mentioned {
			return
		}
		seat = s.turnSeat(domain.MateSeat{Name: name, Owner: m.Owner}, e, author, fromMate)
		stop = domain.MateGuard(limits, seat.Hops, s.mateUsage[name], d.ws.now())
	}) {
		return
	}
	switch {
	case !linked && !mentioned:
		return
	case stop != domain.GuardNone:
		d.mateGuardPost(ctx, client, name, e, stop, limits)
		return
	}
	d.mateGuardClear(name, e, fromMate)
	if !linked {
		link = domain.MateThread{Team: e.Team, Channel: e.Channel, ThreadTS: e.ThreadTS, Mate: name}
	}
	if d.mateSlackTurn(ctx, m, client, e, seat, link, linked) {
		d.query(func(s *state) { s.mateUsage[name] = s.mateUsage[name].AddTurn(d.ws.now()) })
		d.publishMates()
	}
}

func (s *state) turnSeat(base domain.MateSeat, e app.SlackEvent, author string, fromMate bool) domain.MateSeat {
	if !fromMate {
		return domain.DirectMateTurn(base, e.User, e.Text)
	}
	from := domain.MateSeat{Origin: e.User}
	if l, ok := s.mateThreads[domain.MateThreadKey(e.Team, e.Channel, e.ThreadTS, author)]; ok {
		if seat, has := s.mateAskedSeat(l.SessionID); has {
			from = seat
		}
	}
	return domain.ChainMateTurn(base, from, e.User)
}

func guardKey(name string, e app.SlackEvent, stop domain.MateGuardStop) string {
	if stop == domain.GuardHops {
		return domain.MateThreadKey(e.Team, e.Channel, e.ThreadTS, "")
	}
	return domain.MateThreadKey(e.Team, e.Channel, e.ThreadTS, name)
}

func (d *Daemon) mateGuardPost(ctx context.Context, client app.SlackMate, name string, e app.SlackEvent, stop domain.MateGuardStop, limits domain.MateLimits) {
	key := guardKey(name, e, stop)
	d.slack.mu.Lock()
	said := d.slack.guarded[key] == stop
	d.slack.mu.Unlock()
	if said {
		return
	}
	log.Printf("[mates] %s: a guard stopped a turn: %s", name, stop)
	if _, err := client.PostMessage(ctx, e.Channel, e.ThreadTS, domain.MateGuardText(stop, limits)); err != nil {
		log.Printf("[mates] %v", err)
		return
	}
	d.slack.mu.Lock()
	d.slack.guarded[key] = stop
	d.slack.mu.Unlock()
}

func (d *Daemon) mateGuardClear(name string, e app.SlackEvent, fromMate bool) {
	d.slack.mu.Lock()
	defer d.slack.mu.Unlock()
	delete(d.slack.guarded, guardKey(name, e, domain.GuardNone))
	if !fromMate {
		delete(d.slack.guarded, guardKey(name, e, domain.GuardHops))
	}
}

func (d *Daemon) userName(ctx context.Context, client app.SlackMate, user string) string {
	if name, err := client.UserName(ctx, user); err == nil && strings.TrimSpace(name) != "" {
		return name
	}
	return user
}

func (d *Daemon) mateSlackTurn(ctx context.Context, m domain.Mate, client app.SlackMate, e app.SlackEvent, seat domain.MateSeat, link domain.MateThread, linked bool) bool {
	asker := d.userName(ctx, client, e.User)
	src := domain.MateSource{Channel: e.Channel}
	text := domain.MateSourcePrompt(src, domain.MateReplyPrompt(asker, e.Text))
	if !linked {
		text = domain.MateSourcePrompt(src, domain.MateFirstPrompt(m, asker, d.threadLines(ctx, client, e, asker)))
	}
	in := domain.MateInput{Seat: seat, Reply: link}
	session, rerr, ok := d.mateDeliver(m.Name, text, in, func(prompt string, in *domain.MateInput) (domain.Session, *rpc.Error, bool) {
		return d.mateSlackStart(m, e, prompt, in)
	})
	switch {
	case !ok:
		return false
	case rerr != nil:
		d.matePostError(ctx, client, e, rerr.Message)
		return false
	}
	if linked {
		return true
	}
	link.SessionID = session.ID
	if !d.query(func(s *state) {
		s.putMateThread(link)
		for i, q := range s.sends {
			if q.Session == session.ID && q.Mate != nil && q.Mate.Reply.Key() == link.Key() {
				r := *q.Mate
				r.Reply = link
				s.sends[i].Mate = &r
			}
		}
		if cur, has := s.mateReply[session.ID]; has && cur.Key() == link.Key() {
			s.mateReply[session.ID] = link
		}
	}) {
		return false
	}
	ts, err := client.PostMessage(ctx, e.Channel, e.ThreadTS, mateStatusWorks)
	if err != nil {
		log.Printf("[mates] %s: %v", m.Name, err)
		return true
	}
	d.query(func(s *state) {
		if cur, found := s.mateThreads[link.Key()]; found {
			cur.Status = ts
			s.putMateThread(cur)
		}
	})
	return true
}

func (d *Daemon) mateSlackStart(m domain.Mate, e app.SlackEvent, prompt string, in *domain.MateInput) (domain.Session, *rpc.Error, bool) {
	var workspaces []domain.Workspace
	if !d.query(func(s *state) { workspaces = sorted(s.workspaces) }) {
		return domain.Session{}, nil, false
	}
	ws, ok := domain.MateWorkspace(m, workspaces)
	if !ok {
		return domain.Session{}, &rpc.Error{Code: rpc.CodeBadRequest, Message: fmt.Sprintf("%s has no repo to work in. The owner must add a registered single repo to its repos.", m.Name)}, true
	}
	seat := in.Seat
	session, rerr, ok := d.startSessionWith(rpc.NewSessionParams{
		Workspace: ws.Root, WorkItem: mateWorkItem(m.Name, e.Text), Harness: m.Agent, Model: m.Model, Effort: m.Effort, Prompt: prompt,
	}, "", sessionExtras{env: m.Env, input: in, seat: &seat})
	switch {
	case !ok:
		return domain.Session{}, nil, false
	case rerr != nil:
		return domain.Session{}, &rpc.Error{Code: rerr.Code, Message: "crew could not start a session: " + rerr.Message}, true
	}
	return session, nil, true
}

func (s *state) putMateThread(t domain.MateThread) {
	s.emit(MateThreadChanged{Thread: t})
}

type MateThreadChanged struct{ Thread domain.MateThread }

func (e MateThreadChanged) apply(s *state) rpc.Diff {
	s.mateThreads[e.Thread.Key()] = e.Thread
	s.store.PutMateThread(e.Thread)
	link := e.Thread.Link()
	return rpc.Diff{MateThread: &link}
}

func (d *Daemon) threadLines(ctx context.Context, client app.SlackMate, e app.SlackEvent, asker string) []domain.ThreadLine {
	msgs, err := client.Replies(ctx, e.Channel, e.ThreadTS)
	if err != nil || len(msgs) == 0 {
		return []domain.ThreadLine{{Author: asker, Text: e.Text}}
	}
	names := map[string]string{e.User: asker}
	lines := make([]domain.ThreadLine, 0, len(msgs))
	for _, m := range msgs {
		author := "a bot"
		if m.User != "" {
			if _, ok := names[m.User]; !ok {
				names[m.User] = d.userName(ctx, client, m.User)
			}
			author = names[m.User]
		}
		lines = append(lines, domain.ThreadLine{Author: author, Text: m.Text})
	}
	return lines
}

func mateWorkItem(name, text string) string {
	item := []rune(name + ": " + strings.Join(strings.Fields(text), " "))
	if len(item) > mateWorkItemMax {
		item = append(item[:mateWorkItemMax-1], '…')
	}
	return string(item)
}

func (d *Daemon) matePostError(ctx context.Context, client app.SlackMate, e app.SlackEvent, text string) {
	if _, err := client.PostMessage(ctx, e.Channel, e.ThreadTS, text); err != nil {
		log.Printf("[mates] %v", err)
	}
}

func (s *state) mateHooked(session domain.Session, ev domain.SessionEvent) {
	if session.Mate == nil || s.matePost == nil {
		return
	}
	switch ev.Kind {
	case domain.EventPreToolUse, domain.EventStop, domain.EventSessionEnd:
	default:
		return
	}
	t, ok := s.mateReply[session.ID]
	if !ok {
		return
	}
	if cur, found := s.mateThreads[t.Key()]; found {
		t = cur
	}
	t.SessionID = session.ID
	s.matePost(t, ev)
	if ev.Kind != domain.EventPreToolUse {
		delete(s.mateReply, session.ID)
	}
}

func (d *Daemon) queueMatePost(link domain.MateThread, ev domain.SessionEvent) {
	if ev.Kind == domain.EventPreToolUse {
		now := time.Now()
		d.slack.mu.Lock()
		last, seen := d.slack.shown[link.SessionID]
		if seen && now.Sub(last) < mateStatusEvery {
			d.slack.mu.Unlock()
			return
		}
		d.slack.shown[link.SessionID] = now
		d.slack.mu.Unlock()
	}
	go d.matePostback(link, ev)
}

func (d *Daemon) mateClient(name string) app.SlackMate {
	d.slack.mu.Lock()
	defer d.slack.mu.Unlock()
	if w, ok := d.slack.running[name]; ok {
		return w.client
	}
	return nil
}

func (d *Daemon) matePostback(link domain.MateThread, ev domain.SessionEvent) {
	client := d.mateClient(link.Mate)
	if client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(d.ws.ctx, 30*time.Second)
	defer cancel()
	status := func(text string) {
		if link.Status == "" {
			return
		}
		if err := client.UpdateMessage(ctx, link.Channel, link.Status, text); err != nil {
			log.Printf("[mates] %s: %v", link.Mate, err)
		}
	}
	switch ev.Kind {
	case domain.EventPreToolUse:
		status(mateProgress(ev))
	case domain.EventStop:
		status(mateStatusDone)
		if _, err := client.PostMessage(ctx, link.Channel, link.ThreadTS, domain.MateResultText(ev.Text)); err != nil {
			log.Printf("[mates] %s: %v", link.Mate, err)
		}
	case domain.EventSessionEnd:
		status(mateStatusFailed)
	}
}

func mateProgress(ev domain.SessionEvent) string {
	step := strings.TrimSpace(ev.Tool + " " + domain.OneLine(ev.Detail, mateWorkItemMax))
	if step == "" {
		return mateStatusWorks
	}
	return mateStatusWorks + " Now: " + step
}
