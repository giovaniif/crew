package serve

import (
	"encoding/json"
	"net/http"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/syntax"
)

func openReview(r *http.Request, d Daemon) (any, error) {
	q := r.URL.Query()
	p := rpc.ReviewParams{Session: r.PathValue("id"), Scope: domain.ReviewScope(q.Get("scope")), Worktree: q.Get("worktree")}
	var out json.RawMessage
	if err := d.Call(r.Context(), rpc.MethodReviewOpen, p, &out); err != nil {
		return nil, err
	}
	if spanned, err := syntax.ReviewSpans(out); err == nil {
		out = spanned
	}
	return out, nil
}

func viewedParams(r *http.Request, _ string) (any, error) {
	var body struct {
		Mark   *domain.ViewedMark `json:"mark"`
		Viewed bool               `json:"viewed"`
	}
	if err := decodeBody(r, &body); err != nil {
		return nil, err
	}
	if body.Mark == nil || body.Mark.Worktree == "" || body.Mark.Path == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: `send {"mark": {"Worktree","Path","Blob"}, "viewed": bool}`}
	}
	return rpc.ViewedParams{Mark: *body.Mark, Viewed: body.Viewed}, nil
}

func commentParams(r *http.Request, id string) (any, error) {
	var p rpc.CommentParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	p.Session = id
	return p, nil
}

func reviewSendParams(r *http.Request, id string) (any, error) {
	var body struct {
		Note string `json:"note"`
	}
	if r.ContentLength != 0 {
		if err := decodeBody(r, &body); err != nil {
			return nil, err
		}
	}
	return rpc.ReviewSendParams{Session: id, Note: body.Note}, nil
}

func hunkParams(r *http.Request, id string) (any, error) {
	var p rpc.HunkParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	if p.Action != domain.HunkStage && p.Action != domain.HunkRevert {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: `send "action": "stage" or "revert"`}
	}
	p.Session = id
	return p, nil
}
