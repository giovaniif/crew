package rpc

import (
	"context"

	"github.com/giovaniif/crew/internal/domain"
)

const (
	MethodHooks    = "hooks.status"
	MethodHooksFix = "hooks.fix"
)

type HooksFixParams struct {
	Env     string         `json:"env"`
	Harness domain.Harness `json:"harness"`
}

type HooksStatus struct {
	Missing []domain.HooksMissing `json:"missing"`
}

func (c *Client) Hooks(ctx context.Context) (HooksStatus, error) {
	var out HooksStatus
	err := c.Call(ctx, MethodHooks, nil, &out)
	return out, err
}

func (c *Client) FixHooks(ctx context.Context, env string, h domain.Harness) (HooksStatus, error) {
	var out HooksStatus
	err := c.Call(ctx, MethodHooksFix, HooksFixParams{Env: env, Harness: h}, &out)
	return out, err
}
