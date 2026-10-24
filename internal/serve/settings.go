package serve

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/giovaniif/crew/internal/rpc"
)

type handler = func(r *http.Request, d Daemon) (any, error)

func ownerOnly(h handler) handler {
	return func(r *http.Request, d Daemon) (any, error) {
		if !fromOwner(r) {
			return nil, &rpc.Error{Code: codeForbidden, Message: "only the owner device, the app on the computer that runs crew, can do this"}
		}
		return h(r, d)
	}
}

func fromOwner(r *http.Request) bool {
	addr := clientAddr(r)
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func callThrough(method string, params func(r *http.Request) (any, error)) handler {
	return func(r *http.Request, d Daemon) (any, error) {
		p, err := params(r)
		if err != nil {
			return nil, err
		}
		var out json.RawMessage
		if err := d.Call(r.Context(), method, p, &out); err != nil {
			return nil, err
		}
		if len(out) == 0 || string(out) == "null" {
			out = json.RawMessage(`{}`)
		}
		return out, nil
	}
}

func noParams(*http.Request) (any, error) {
	return struct{}{}, nil
}

func configSetParams(r *http.Request) (any, error) {
	var p rpc.ConfigSetParams
	if err := decodeOne(r, &p, "key and value"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.Key) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "key is empty"}
	}
	return p, nil
}

func harnessParams(r *http.Request) (any, error) {
	var p rpc.OnboardInstallParams
	if err := decodeOne(r, &p, "harness"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(p.Harness)) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "harness is empty"}
	}
	return p, nil
}

func hooksFixParams(r *http.Request) (any, error) {
	var p rpc.HooksFixParams
	if err := decodeOne(r, &p, "env and harness"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(p.Harness)) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "harness is empty"}
	}
	return p, nil
}

func trustQueryParams(r *http.Request) (any, error) {
	path := r.URL.Query().Get("path")
	if strings.TrimSpace(path) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "path is empty"}
	}
	return rpc.ClaudeTrustParams{Path: path}, nil
}

func trustBodyParams(r *http.Request) (any, error) {
	var p rpc.ClaudeTrustParams
	if err := decodeOne(r, &p, "path"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.Path) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "path is empty"}
	}
	return p, nil
}

func dirsParams(r *http.Request) (any, error) {
	path := r.URL.Query().Get("path")
	if strings.TrimSpace(path) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "path is empty"}
	}
	return rpc.WorkspaceDirsParams{Path: path}, nil
}

func completeParams(r *http.Request) (any, error) {
	return rpc.FSCompleteParams{Path: r.URL.Query().Get("path")}, nil
}

func revokeParams(r *http.Request) (any, error) {
	return rpc.DeviceRevokeParams{ID: r.PathValue("id")}, nil
}

func pairCodeParams(r *http.Request) (any, error) {
	var p rpc.PairCodeParams
	if r.ContentLength == 0 {
		return p, nil
	}
	if err := decodeOne(r, &p, "name"); err != nil {
		return nil, err
	}
	return p, nil
}

func settingsRoutes() []route {
	owner := func(pattern, method string, params func(r *http.Request) (any, error)) route {
		return route{pattern, ownerOnly(callThrough(method, params))}
	}
	return []route{
		owner("GET /api/v1/config", rpc.MethodConfigGet, noParams),
		owner("POST /api/v1/config", rpc.MethodConfigSet, configSetParams),
		owner("GET /api/v1/onboarding", rpc.MethodOnboarding, noParams),
		owner("POST /api/v1/onboarding/install", rpc.MethodOnboardingInstall, harnessParams),
		owner("POST /api/v1/onboarding/remove", rpc.MethodOnboardingRemove, harnessParams),
		owner("POST /api/v1/onboarding/nvim", rpc.MethodOnboardingNvim, noParams),
		owner("POST /api/v1/onboarding/finish", rpc.MethodOnboardingFinish, noParams),
		owner("GET /api/v1/hooks", rpc.MethodHooks, noParams),
		owner("POST /api/v1/hooks/fix", rpc.MethodHooksFix, hooksFixParams),
		owner("GET /api/v1/claude/trust", rpc.MethodClaudeTrustStatus, trustQueryParams),
		owner("POST /api/v1/claude/trust", rpc.MethodClaudeTrust, trustBodyParams),
		owner("GET /api/v1/workspaces/dirs", rpc.MethodWorkspaceDirs, dirsParams),
		owner("GET /api/v1/fs/complete", rpc.MethodFSComplete, completeParams),
		owner("GET /api/v1/devices", rpc.MethodDeviceList, noParams),
		owner("POST /api/v1/devices/{id}/revoke", rpc.MethodDeviceRevoke, revokeParams),
		owner("POST /api/v1/pair/code", rpc.MethodPairCode, pairCodeParams),
	}
}
