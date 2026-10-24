package daemon

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"time"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const hooksCheckEvery = 5 * time.Minute

type hooksWatch struct {
	checker app.HooksChecker
	mu      sync.Mutex
	missing []domain.HooksMissing
}

func WithHooksChecker(c app.HooksChecker) Option {
	return func(d *Daemon) { d.hooks = &hooksWatch{checker: c} }
}

func (d *Daemon) missingHooks() []domain.HooksMissing {
	if d.hooks == nil {
		return nil
	}
	d.hooks.mu.Lock()
	defer d.hooks.mu.Unlock()
	return slices.Clone(d.hooks.missing)
}

func (d *Daemon) envHooks(name string) []domain.HooksMissing {
	var out []domain.HooksMissing
	for _, m := range d.missingHooks() {
		if m.Env == name {
			out = append(out, m)
		}
	}
	return out
}

func (d *Daemon) checkHooks(ctx context.Context) []domain.HooksMissing {
	var custom []domain.Environment
	if d.envs != nil {
		list, _ := d.envs.List()
		for _, e := range list {
			if e.Kind == domain.EnvCustom {
				custom = append(custom, e)
			}
		}
	}
	missing := d.hooks.checker.Hooks(ctx, custom)
	d.hooks.mu.Lock()
	d.hooks.missing = missing
	d.hooks.mu.Unlock()
	return slices.Clone(missing)
}

func (d *Daemon) watchHooks(ctx context.Context) {
	t := time.NewTicker(hooksCheckEvery)
	defer t.Stop()
	for {
		d.checkHooks(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (d *Daemon) hooksMethod(req rpc.Request) *rpc.Response {
	if d.hooks == nil {
		return errorResponse(req.ID, rpc.CodeUnavailable, "this daemon does not check hooks")
	}
	ctx := d.ws.ctx
	if req.Method == rpc.MethodHooks {
		return result(req.ID, rpc.HooksStatus{Missing: nonNil(d.missingHooks())})
	}
	var p rpc.HooksFixParams
	if err := json.Unmarshal(req.Params, &p); err != nil || !slices.Contains(domain.Harnesses(), p.Harness) {
		return errorResponse(req.ID, rpc.CodeBadRequest, "hooks.fix needs a harness: claude, codex or omp")
	}
	env := domain.Environment{Name: string(domain.EnvLocal), Kind: domain.EnvLocal}
	if p.Env != "" && p.Env != string(domain.EnvLocal) {
		var err error
		if d.envs == nil {
			return errorResponse(req.ID, rpc.CodeNotFound, "no environment "+p.Env)
		}
		if env, err = d.envs.Get(p.Env); err != nil {
			return errorResponse(req.ID, rpc.CodeNotFound, "no environment "+p.Env)
		}
	}
	if err := d.hooks.checker.FixHooks(ctx, env, p.Harness); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	return result(req.ID, rpc.HooksStatus{Missing: nonNil(d.checkHooks(ctx))})
}

func nonNil(m []domain.HooksMissing) []domain.HooksMissing {
	if m == nil {
		return []domain.HooksMissing{}
	}
	return m
}
