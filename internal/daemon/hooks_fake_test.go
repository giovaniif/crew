package daemon_test

import (
	"context"
	"slices"
	"sync"

	"github.com/giovaniif/crew/internal/domain"
)

type fakeHooks struct {
	mu      sync.Mutex
	missing []domain.HooksMissing
	envs    []string
	checks  int
	fixed   []string
}

func (f *fakeHooks) Hooks(_ context.Context, envs []domain.Environment) []domain.HooksMissing {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checks++
	f.envs = nil
	for _, e := range envs {
		f.envs = append(f.envs, e.Name)
	}
	return slices.Clone(f.missing)
}

func (f *fakeHooks) FixHooks(_ context.Context, env domain.Environment, h domain.Harness) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fixed = append(f.fixed, env.Name+"/"+string(h))
	f.missing = slices.DeleteFunc(f.missing, func(m domain.HooksMissing) bool { return m.Env == env.Name && m.Harness == h })
	return nil
}
