package onboard

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/giovaniif/crew/internal/domain"
)

func (p Probe) Hooks(_ context.Context, envs []domain.Environment) []domain.HooksMissing {
	var out []domain.HooksMissing
	for _, h := range domain.Harnesses() {
		if m, ok := domain.CheckHooks(string(domain.EnvLocal), h, p.setup(h), p.UserHome); ok {
			out = append(out, m)
		}
	}
	for _, env := range envs {
		for _, h := range domain.Harnesses() {
			dir := domain.EnvHarnessDir(env, h)
			if dir == "" || !isDir(dir) {
				continue
			}
			s := p.forEnvDir(dir).setup(h)
			s.SetUp = true
			if m, ok := domain.CheckHooks(env.Name, h, s, p.UserHome); ok {
				out = append(out, m)
			}
		}
	}
	return out
}

func (p Probe) FixHooks(ctx context.Context, env domain.Environment, h domain.Harness) error {
	if env.Kind != domain.EnvCustom {
		_, err := p.Install(ctx, h)
		return err
	}
	dir := domain.EnvHarnessDir(env, h)
	if dir == "" {
		return errors.New("environment " + env.Name + " has no " + string(h) + " part")
	}
	_, err := p.forEnvDir(dir).Install(ctx, h)
	return err
}

func (p Probe) forEnvDir(dir string) Probe {
	q := Probe{Home: p.Home, Bin: p.Bin, UserHome: p.UserHome}
	q.ClaudeSettings = filepath.Join(dir, "settings.json")
	q.CodexHome = dir
	q.OmpAgentDir = dir
	return q
}

func (p Probe) setup(h domain.Harness) domain.HarnessSetup {
	switch h {
	case domain.HarnessClaude:
		return p.claudeSetup()
	case domain.HarnessCodex:
		return p.codexSetup()
	}
	return p.ompSetup()
}
