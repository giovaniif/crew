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

func listEnvironments(r *http.Request, d Daemon) (any, error) {
	var out rpc.EnvironmentList
	if err := d.Call(r.Context(), rpc.MethodEnvironmentList, struct{}{}, &out); err != nil {
		return nil, err
	}
	if out.Identities == nil {
		out.Identities = []rpc.EnvInfo{}
	}
	return out, nil
}

func identityCall(method string) func(r *http.Request, d Daemon) (any, error) {
	return func(r *http.Request, d Daemon) (any, error) {
		name := r.PathValue("name")
		var params any
		switch method {
		case rpc.MethodIdentitySet:
			p := rpc.EnvCreateParams{}
			if err := decodeBody(r, &p); err != nil {
				return nil, err
			}
			p.Name = name
			params = p
		case rpc.MethodIdentitySetSecret:
			p := rpc.EnvSetParams{}
			if err := decodeBody(r, &p); err != nil {
				return nil, err
			}
			params = rpc.EnvSetParams{Name: name, Secret: p.Secret, Value: p.Value}
		case rpc.MethodIdentitySSHKey:
			p := rpc.EnvSSHKeyParams{}
			if r.Method == http.MethodPost {
				if err := decodeBody(r, &p); err != nil {
					return nil, err
				}
			}
			p.Name = name
			params = p
		default:
			params = rpc.EnvNameParams{Name: name}
		}
		return envCall(r, d, method, params)
	}
}

func identityAction(r *http.Request, d Daemon) (any, error) {
	name, action := r.PathValue("name"), r.PathValue("action")
	switch {
	case name == "copy" && action == "begin":
		return ownerOnly(identityCopyBegin)(r, d)
	case name == "copy":
		return ownerOnly(identityImport)(r, d)
	case action == "export":
		return ownerOnly(identityExport)(r, d)
	case action == "secret":
		return identityCall(rpc.MethodIdentitySetSecret)(r, d)
	case action == "ssh-key":
		return identityCall(rpc.MethodIdentitySSHKey)(r, d)
	}
	return nil, &rpc.Error{Code: rpc.CodeNotFound, Message: "no endpoint " + r.Method + " " + r.URL.Path}
}

func identityCopyBegin(r *http.Request, d Daemon) (any, error) {
	var out rpc.IdentityCopyBegin
	if err := d.Call(r.Context(), rpc.MethodIdentityCopyBegin, struct{}{}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func identityExport(r *http.Request, d Daemon) (any, error) {
	var p rpc.IdentityExportParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	p.Name = r.PathValue("name")
	var out rpc.IdentityExport
	if err := d.Call(r.Context(), rpc.MethodIdentityExport, p, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func identityImport(r *http.Request, d Daemon) (any, error) {
	var p rpc.IdentityImportParams
	if err := decodeBody(r, &p); err != nil {
		return nil, err
	}
	p.CopyID = r.PathValue("action")
	return envCall(r, d, rpc.MethodIdentityImport, p)
}
