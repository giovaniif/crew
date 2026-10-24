package rpc

import "context"

const (
	MethodClaudeTrustStatus = "claude.trust_status"
	MethodClaudeTrust       = "claude.trust"
)

type ClaudeTrustParams struct {
	Path string `json:"path"`
}

type ClaudeTrustStatus struct {
	Path    string `json:"path"`
	Trusted bool   `json:"trusted"`
}

func (c *Client) ClaudeTrust(ctx context.Context, path string) (ClaudeTrustStatus, error) {
	var out ClaudeTrustStatus
	err := c.Call(ctx, MethodClaudeTrustStatus, ClaudeTrustParams{Path: path}, &out)
	return out, err
}

func (c *Client) TrustClaude(ctx context.Context, path string) (ClaudeTrustStatus, error) {
	var out ClaudeTrustStatus
	err := c.Call(ctx, MethodClaudeTrust, ClaudeTrustParams{Path: path}, &out)
	return out, err
}
