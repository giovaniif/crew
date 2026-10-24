package app

import (
	"context"

	"github.com/giovaniif/crew/internal/domain"
)

type HooksChecker interface {
	Hooks(ctx context.Context, envs []domain.Environment) []domain.HooksMissing
	FixHooks(ctx context.Context, env domain.Environment, h domain.Harness) error
}
