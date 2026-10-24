package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func (d *Daemon) mateMemoryPath(name string) string {
	return filepath.Join(filepath.Dir(d.cfg.path), "mates", name, "memory.md")
}

func (d *Daemon) readMateMemory(name string) (string, error) {
	b, err := os.ReadFile(d.mateMemoryPath(name))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	return string(b), err
}

func (d *Daemon) mateMemory(req rpc.Request) *rpc.Response {
	var p rpc.MateSetMemoryParams
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, req.Method+" needs a name")
	}
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	if !hasMate(d.loadMates(src).Mates, p.Name) {
		return errorResponse(req.ID, rpc.CodeNotFound, fmt.Sprintf("no mate %q", p.Name))
	}
	path := d.mateMemoryPath(p.Name)
	if req.Method == rpc.MethodMateSetMemory {
		if err := domain.CheckMateMemory(p.Text); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
		if err := writeMateMemory(path, p.Text); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
	}
	text, err := d.readMateMemory(p.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	return result(req.ID, rpc.MateMemory{Name: p.Name, Path: path, Text: text, Limit: domain.MateMemoryLimit})
}

func writeMateMemory(path, text string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".memory-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.WriteString(text); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func hasMate(mates []domain.Mate, name string) bool {
	for _, m := range mates {
		if m.Name == name {
			return true
		}
	}
	return false
}

func (d *Daemon) mateNew(req rpc.Request) (*rpc.Response, bool) {
	var p rpc.MateNewParams
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, "mate.new needs a name"), true
	}
	if _, _, ok := d.findMate(p.Name); !ok || !domain.SendableText(p.Prompt) {
		return d.startMateConversation(req.ID, p, mateStart{})
	}
	in := domain.MateInput{Seat: domain.MateSeat{Local: true}}
	var resp *rpc.Response
	session, rerr, ok := d.mateDeliver(p.Name, p.Prompt, in, func(prompt string, in *domain.MateInput) (domain.Session, *rpc.Error, bool) {
		r, ok := d.startMateConversation(req.ID, rpc.MateNewParams{Name: p.Name, Repo: p.Repo, Prompt: prompt}, mateStart{input: in})
		resp = r
		return domain.Session{}, nil, ok
	})
	switch {
	case !ok:
		return nil, false
	case resp != nil:
		return resp, true
	case rerr != nil:
		return errorResponse(req.ID, rerr.Code, rerr.Message), true
	}
	return result(req.ID, rpc.MateNewResult{Session: session, Added: true}), true
}

func (d *Daemon) mateFresh(req rpc.Request) (*rpc.Response, bool) {
	var p rpc.MateFreshParams
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Session) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, "mate.fresh needs a session"), true
	}
	var old domain.Session
	var found bool
	if !d.query(func(s *state) { old, found = s.sessions[p.Session] }) {
		return nil, false
	}
	switch {
	case !found:
		return errorResponse(req.ID, rpc.CodeNotFound, "no session "+p.Session), true
	case old.Mate == nil:
		return errorResponse(req.ID, rpc.CodeBadRequest, "session "+p.Session+" is not a conversation with a mate"), true
	}
	if !old.Ended {
		resp, ok := d.sessionSend(rpc.Request{Method: rpc.MethodSessionSend, Params: mustJSON(rpc.SessionSendParams{Session: old.ID, Text: domain.MateHandoffPrompt(d.mateMemoryPath(old.Mate.Name))})})
		switch {
		case !ok:
			return nil, false
		case resp.Error != nil:
			return errorResponse(req.ID, resp.Error.Code, "crew could not ask for a handoff: "+resp.Error.Message), true
		}
	}
	if !d.retireMateSession(old.ID) {
		return nil, false
	}
	dir := ""
	if p.SameWorktree {
		dir = old.Dir
	}
	return d.startMateConversation(req.ID, rpc.MateNewParams{Name: old.Mate.Name, Prompt: p.Prompt}, mateStart{dir: dir, workspace: old.StartWorkspace, freshFrom: old.ID})
}

type mateStart struct {
	dir       string
	workspace string
	freshFrom string
	input     *domain.MateInput
}

func (d *Daemon) startMateConversation(id uint64, p rpc.MateNewParams, at mateStart) (*rpc.Response, bool) {
	req := rpc.Request{ID: id}
	m, _, ok := d.findMate(p.Name)
	if !ok {
		return errorResponse(req.ID, rpc.CodeNotFound, fmt.Sprintf("no mate %q", p.Name)), true
	}
	var workspaces []domain.Workspace
	if !d.query(func(s *state) { workspaces = sorted(s.workspaces) }) {
		return nil, false
	}
	root := at.workspace
	if root == "" {
		var err error
		if root, err = domain.MateStartRoot(m, workspaces, p.Repo); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error()), true
		}
	}
	memory, err := d.readMateMemory(m.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error()), true
	}
	system := domain.MateSystemPrompt(m, memory, d.mateMemoryPath(m.Name))
	seat := &domain.MateSeat{Name: m.Name, Owner: m.Owner, Local: true, FreshFrom: at.freshFrom}
	session, rerr, ok := d.startSessionWith(rpc.NewSessionParams{
		Workspace: root, WorkItem: mateWorkItem(m.Name, p.Prompt), Harness: m.Agent, Model: m.Model, Effort: m.Effort, Prompt: p.Prompt,
	}, "", sessionExtras{system: system, seat: seat, dir: at.dir, env: m.Env, input: at.input})
	switch {
	case !ok:
		return nil, false
	case rerr != nil:
		return errorResponse(req.ID, rerr.Code, rerr.Message), true
	}
	return result(req.ID, session), true
}

type systemPromptHarness struct {
	app.HarnessAdapter
	system string
}

func (h systemPromptHarness) Launch(req app.LaunchRequest) app.PaneSpec {
	req.SystemPrompt = h.system
	return h.HarnessAdapter.Launch(req)
}

func (d *Daemon) mateResumeAdapter(session domain.Session, adapter app.HarnessAdapter) (app.HarnessAdapter, *rpc.Error) {
	if session.Mate == nil {
		return adapter, nil
	}
	m, _, ok := d.findMate(session.Mate.Name)
	if !ok {
		return adapter, nil
	}
	adapter = d.envAdapter(adapter, m.Env)
	if !session.Mate.Local {
		return adapter, nil
	}
	memory, err := d.readMateMemory(m.Name)
	if err != nil {
		return nil, &rpc.Error{Code: rpc.CodeFailed, Message: err.Error()}
	}
	return systemPromptHarness{HarnessAdapter: adapter, system: domain.MateSystemPrompt(m, memory, d.mateMemoryPath(m.Name))}, nil
}
