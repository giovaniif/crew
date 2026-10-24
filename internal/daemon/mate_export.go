package daemon

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func (d *Daemon) mateExport(req rpc.Request) *rpc.Response {
	var p rpc.MateNameParams
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, "mate.export needs a name")
	}
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	for _, m := range d.loadMates(src).Mates {
		if m.Name != p.Name {
			continue
		}
		memory, err := d.readMateMemory(m.Name)
		if err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
		return result(req.ID, rpc.MateExport{Mate: domain.ExportableMate(m), Memory: memory})
	}
	return errorResponse(req.ID, rpc.CodeNotFound, fmt.Sprintf("no mate %q", p.Name))
}

func (d *Daemon) mateImport(req rpc.Request) *rpc.Response {
	var p rpc.MateImportParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "mate.import params: "+err.Error())
	}
	if err := domain.CheckMateMemory(p.Export.Memory); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
	}
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	var used []string
	for _, m := range d.loadMates(src).Mates {
		used = append(used, m.Name)
	}
	m := domain.ExportableMate(p.Export.Mate)
	m.Name = domain.MateImportName(m.Name, used)
	if domain.ValidateMate(m, d.registeredWorkspaces()) != nil {
		m.Repos = nil
	}
	set, _ := json.Marshal(rpc.MateSetParams{Mate: m, Environment: p.Environment})
	resp := d.mateSet(rpc.Request{V: req.V, ID: req.ID, Method: rpc.MethodMateSet, Params: set})
	if resp.Error != nil {
		return resp
	}
	if p.Export.Memory != "" {
		if err := writeMateMemory(d.mateMemoryPath(m.Name), p.Export.Memory); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
	}
	return resp
}
