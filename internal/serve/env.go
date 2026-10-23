package serve

import (
	"net/http"

	"github.com/giovaniif/crew/internal/rpc"
)

func listEnvs(r *http.Request, d Daemon) (any, error) {
	var out rpc.EnvList
	if err := d.Call(r.Context(), rpc.MethodEnvList, struct{}{}, &out); err != nil {
		return nil, err
	}
	if out.Envs == nil {
		out.Envs = []rpc.EnvInfo{}
	}
	return out, nil
}

func createEnv(r *http.Request, d Daemon) (any, error) {
	var p rpc.EnvCreateParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	return envCall(r, d, rpc.MethodEnvCreate, p)
}

func envCall(r *http.Request, d Daemon, method string, params any) (any, error) {
	var out rpc.EnvInfo
	if err := d.Call(r.Context(), method, params, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func envByName(method string) func(r *http.Request, d Daemon) (any, error) {
	return func(r *http.Request, d Daemon) (any, error) {
		return envCall(r, d, method, rpc.EnvNameParams{Name: r.PathValue("name")})
	}
}

func setEnv(r *http.Request, d Daemon) (any, error) {
	var p rpc.EnvSetParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	p.Name = r.PathValue("name")
	return envCall(r, d, rpc.MethodEnvSet, p)
}

func unsetEnv(r *http.Request, d Daemon) (any, error) {
	var p rpc.EnvUnsetParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	p.Name = r.PathValue("name")
	return envCall(r, d, rpc.MethodEnvUnset, p)
}

func envSSHKey(r *http.Request, d Daemon) (any, error) {
	var p rpc.EnvSSHKeyParams
	if r.Method == http.MethodPost {
		if err := decodeBody(r, &p); err != nil {
			return nil, err
		}
	}
	p.Name = r.PathValue("name")
	return envCall(r, d, rpc.MethodEnvSSHKey, p)
}
