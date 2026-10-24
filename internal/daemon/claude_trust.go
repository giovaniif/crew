package daemon

import (
	"encoding/json"
	"path/filepath"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/rpc"
)

func WithClaudeTrust(t app.ClaudeTrust) Option {
	return func(d *Daemon) { d.claudeTrust = t }
}

func (d *Daemon) claudeTrustMethod(req rpc.Request) *rpc.Response {
	if d.claudeTrust == nil {
		return errorResponse(req.ID, rpc.CodeUnavailable, "this daemon does not read the Claude trust")
	}
	var p rpc.ClaudeTrustParams
	if err := json.Unmarshal(req.Params, &p); err != nil || !filepath.IsAbs(p.Path) {
		return errorResponse(req.ID, rpc.CodeBadRequest, "claude trust needs an absolute path")
	}
	if req.Method == rpc.MethodClaudeTrust {
		if err := d.claudeTrust.TrustDir(p.Path); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
	}
	ok, err := d.claudeTrust.Trusted(p.Path)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	return result(req.ID, rpc.ClaudeTrustStatus{Path: p.Path, Trusted: ok})
}
