package daemon

import (
	"cmp"
	"context"
	"encoding/json"
	"path/filepath"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func (d *Daemon) resolveWorkItem(req rpc.Request) (*rpc.Response, bool) {
	var p rpc.ResolveWorkItemParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "session.resolve params: "+err.Error()), true
	}
	parsed, err := domain.CheckWorkItem(p.WorkItem)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, err.Error()), true
	}
	if p.Workspace != "" {
		if !filepath.IsAbs(p.Workspace) {
			return errorResponse(req.ID, rpc.CodeBadRequest, "workspace must be an absolute path: "+p.Workspace), true
		}
		p.Workspace = filepath.Clean(p.Workspace)
	}
	var in newSessionInput
	if !d.query(func(s *state) { in = s.newSessionInput(p.Workspace, parsed) }) {
		return nil, false
	}
	switch {
	case in.missing != "" && p.Workspace == "":
		return errorResponse(req.ID, rpc.CodeBadRequest, in.missing), true
	case in.missing != "":
		return errorResponse(req.ID, rpc.CodeNotFound, in.missing), true
	}
	title, rerr := d.titleFor(in.task, !in.isNew)
	if rerr != nil {
		return errorResponse(req.ID, rerr.Code, rerr.Message), true
	}
	plan := domain.PlanSessionStart(in.ws, domain.TaskSlug(in.task), d.sess.worktreeHome, in.taken)
	at := domain.PreviewSessionStart(in.ws, plan)
	return result(req.ID, rpc.WorkItemResolved{
		Source: string(in.task.Source), Ref: in.task.Ref, Title: title, Worktree: at.Worktree, Workspace: in.ws.Root, Dir: at.Dir, Git: at.Git,
	}), true
}

func (d *Daemon) titleFor(task domain.Task, known bool) (string, *rpc.Error) {
	if task.Source == domain.TaskText {
		return task.Text, nil
	}
	if known {
		if title := cmp.Or(task.PRTitle, task.IssueTitle); title != "" {
			return title, nil
		}
	}
	if d.titles == nil {
		return task.IssueTitle, nil
	}
	ctx, cancel := context.WithTimeout(d.ws.ctx, titleTimeout)
	defer cancel()
	title, err := d.titles.Title(ctx, task)
	if err != nil {
		return "", &rpc.Error{Code: rpc.CodeNotFound, Message: task.Ref + ": " + err.Error()}
	}
	return title, nil
}
