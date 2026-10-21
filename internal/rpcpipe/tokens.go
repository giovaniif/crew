package rpcpipe

import (
	"encoding/json"

	"github.com/giovaniif/crew/internal/rpc"
)

type reviewOpenParams struct {
	Tokens bool `json:"tokens"`
}

func wantsTokens(req rpc.Request) bool {
	if req.Method != rpc.MethodReviewOpen || len(req.Params) == 0 {
		return false
	}
	var p reviewOpenParams
	return json.Unmarshal(req.Params, &p) == nil && p.Tokens
}
