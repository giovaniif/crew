package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

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
	m, _, ok := d.findMate(p.Name)
	if !ok {
		return errorResponse(req.ID, rpc.CodeNotFound, fmt.Sprintf("no mate %q", p.Name)), true
	}
	var workspaces []domain.Workspace
	if !d.query(func(s *state) { workspaces = sorted(s.workspaces) }) {
		return nil, false
	}
	root := ""
	if ws, found := domain.MateRepoWorkspace(m, workspaces, p.Repo); found {
		root = ws.Root
	} else if p.Repo != "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("repo %q is not a registered single-repo workspace", p.Repo)), true
	}
	memory, err := d.readMateMemory(m.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error()), true
	}
	system := domain.MateSystemPrompt(m, memory, d.mateMemoryPath(m.Name))
	seat := &domain.MateSeat{Name: m.Name, Owner: m.Owner, Local: true}
	session, rerr, ok := d.startSessionWith(rpc.NewSessionParams{
		Workspace: root, WorkItem: mateWorkItem(m.Name, p.Prompt), Harness: m.Agent, Model: m.Model, Effort: m.Effort, Prompt: p.Prompt,
	}, "", system, seat)
	switch {
	case !ok:
		return nil, false
	case rerr != nil:
		return errorResponse(req.ID, rerr.Code, rerr.Message), true
	}
	return result(req.ID, session), true
}
