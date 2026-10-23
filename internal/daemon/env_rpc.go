package daemon

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func WithEnvironments(s app.EnvironmentStore) Option {
	return func(d *Daemon) { d.envs = s }
}

const localFactsTTL = 30 * time.Second

type localFactsCache struct {
	mu    sync.Mutex
	probe app.LocalProbe
	at    time.Time
	facts app.LocalFacts
}

func (c *localFactsCache) get() app.LocalFacts {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.at.IsZero() || time.Since(c.at) > localFactsTTL {
		c.facts = c.probe.Local()
		c.at = time.Now()
	}
	return c.facts
}

func WithLocalProbe(p app.LocalProbe) Option {
	return func(d *Daemon) { d.localFacts = &localFactsCache{probe: p} }
}

func (d *Daemon) envMethod(req rpc.Request) *rpc.Response {
	if d.envs == nil || d.cfg.path == "" {
		return errorResponse(req.ID, rpc.CodeUnavailable, "this daemon has no environment store")
	}
	d.cfg.mu.Lock()
	defer d.cfg.mu.Unlock()
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	mates, _ := parseMates(src, d.cfg.path)
	if req.Method == rpc.MethodEnvList {
		return d.envList(req, mates)
	}
	var p struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(req.Params, &p); err != nil || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, req.Method+" needs a name and valid params")
	}
	if req.Method == rpc.MethodEnvCreate {
		return d.envCreate(req, mates)
	}
	env, err := d.envs.Get(p.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeNotFound, err.Error())
	}
	switch req.Method {
	case rpc.MethodEnvShow:
		return result(req.ID, d.envInfo(env, mates))
	case rpc.MethodEnvSet:
		return d.envSet(req, env, mates)
	case rpc.MethodEnvUnset:
		var u rpc.EnvUnsetParams
		_ = json.Unmarshal(req.Params, &u)
		if err := d.envs.ClearSecret(env.Name, u.Secret); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
		return result(req.ID, d.envInfo(env, mates))
	case rpc.MethodEnvDelete:
		if users := domain.MatesUsingEnv(mates, env.Name); len(users) > 0 {
			return errorResponse(req.ID, rpc.CodeFailed, fmt.Sprintf("environment %s is used by mate %s", env.Name, strings.Join(users, ", ")))
		}
		if err := d.envs.Delete(env.Name); err != nil {
			return errorResponse(req.ID, rpc.CodeNotFound, err.Error())
		}
		return result(req.ID, d.envInfo(env, nil))
	case rpc.MethodEnvSSHKey:
		return d.envSSHKey(req, env, mates)
	}
	return errorResponse(req.ID, rpc.CodeUnknownMethod, req.Method)
}

func (d *Daemon) envInfo(env domain.Environment, mates []domain.Mate) rpc.EnvInfo {
	info := rpc.EnvInfo{Name: env.Name, Kind: env.Kind, Parts: env.Parts, Secrets: []rpc.EnvSecret{}, UsedBy: []string{}}
	if info.Parts == nil {
		info.Parts = []domain.EnvPart{}
	}
	set := d.envs.SecretsSet(env.Name)
	for _, name := range domain.EnvSecretNames(env) {
		info.Secrets = append(info.Secrets, rpc.EnvSecret{Name: name, Set: set[name]})
	}
	if pub, err := d.envs.PublicKey(env.Name); err == nil {
		info.PublicKey = pub
		if at, err := d.envs.KeyCreated(env.Name); err == nil {
			info.KeyCreated = at.UTC().Format(time.RFC3339)
		}
	}
	if next, err := d.envs.NewPublicKey(env.Name); err == nil {
		info.NewPublicKey = next
	}
	if env.Kind != domain.EnvLocal {
		info.GitName, info.GitEmail = d.envs.GitIdentity(env.Name)
	} else if d.localFacts != nil {
		f := d.localFacts.get()
		info.Local = &rpc.EnvLocal{GitName: f.GitName, GitEmail: f.GitEmail, SSHAgent: f.SSHAgent, SSHKeys: f.SSHKeys, GitHub: f.GitHub, GitHubUser: f.GitHubUser, Claude: f.Claude, Codex: f.Codex, Pi: f.Pi}
	}
	users := domain.MatesUsingEnv(mates, env.Name)
	if env.Kind == domain.EnvLocal && env.Name == string(domain.EnvLocal) {
		users = append(users, domain.MatesUsingEnv(mates, "")...)
	}
	if users != nil {
		info.UsedBy = users
	}
	return info
}

func (d *Daemon) envList(req rpc.Request, mates []domain.Mate) *rpc.Response {
	list, err := d.envs.List()
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	out := rpc.EnvList{Envs: []rpc.EnvInfo{}}
	hasLocal := false
	for _, env := range list {
		hasLocal = hasLocal || env.Name == string(domain.EnvLocal)
	}
	if !hasLocal {
		out.Envs = append(out.Envs, d.envInfo(domain.Environment{Name: string(domain.EnvLocal), Kind: domain.EnvLocal}, mates))
	}
	for _, env := range list {
		out.Envs = append(out.Envs, d.envInfo(env, mates))
	}
	return result(req.ID, out)
}

func (d *Daemon) envExists(name string) bool {
	list, err := d.envs.List()
	if err != nil {
		return false
	}
	for _, env := range list {
		if env.Name == name {
			return true
		}
	}
	return false
}

func (d *Daemon) envCreate(req rpc.Request, mates []domain.Mate) *rpc.Response {
	var p rpc.EnvCreateParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "env.create params: "+err.Error())
	}
	if d.envExists(p.Name) {
		return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("environment %s exists; its kind is fixed", p.Name))
	}
	if p.Name == string(domain.EnvLocal) && p.Kind != domain.EnvLocal {
		return errorResponse(req.ID, rpc.CodeBadRequest, "the environment local must be of kind local")
	}
	if p.Kind == domain.EnvLocal && (p.GitName != "" || p.GitEmail != "") {
		return errorResponse(req.ID, rpc.CodeBadRequest, "a local environment has no git identity")
	}
	env := domain.Environment{Name: p.Name, Kind: p.Kind, Parts: p.Parts}
	if err := domain.ValidateEnvironment(env); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
	}
	if err := d.envs.Save(env); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	if p.GitName != "" || p.GitEmail != "" {
		if err := d.envs.WriteGitConfig(env.Name, p.GitName, p.GitEmail); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
	}
	return d.envReload(req, env.Name, mates)
}

func (d *Daemon) envReload(req rpc.Request, name string, mates []domain.Mate) *rpc.Response {
	env, err := d.envs.Get(name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	return result(req.ID, d.envInfo(env, mates))
}

func (d *Daemon) envSet(req rpc.Request, env domain.Environment, mates []domain.Mate) *rpc.Response {
	var p rpc.EnvSetParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "env.set params are not valid")
	}
	git := p.GitName != "" || p.GitEmail != ""
	if env.Kind == domain.EnvLocal && (p.Parts != nil || git) {
		return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("environment %s is local: it takes only extra secret variables", env.Name))
	}
	if p.Parts == nil && !git && p.Secret == "" {
		return errorResponse(req.ID, rpc.CodeBadRequest, "env.set needs parts, a git identity or a secret")
	}
	if p.Parts != nil {
		next := env
		next.Parts = *p.Parts
		if err := domain.ValidateEnvironment(next); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
		if err := d.envs.Save(next); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
	}
	if git {
		if err := d.envs.WriteGitConfig(env.Name, p.GitName, p.GitEmail); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
	}
	if p.Secret != "" {
		if p.Value == "" {
			return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("env.set: %s needs a value; use env.unset to remove it", p.Secret))
		}
		if !d.envExists(env.Name) {
			if err := d.envs.Save(env); err != nil {
				return errorResponse(req.ID, rpc.CodeFailed, err.Error())
			}
		}
		if err := d.envs.SetSecret(env.Name, p.Secret, p.Value); err != nil {
			return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
		}
	}
	return d.envReload(req, env.Name, mates)
}

func (d *Daemon) envSSHKey(req rpc.Request, env domain.Environment, mates []domain.Mate) *rpc.Response {
	var p rpc.EnvSSHKeyParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "env.ssh_key params are not valid")
	}
	if p.Action != rpc.EnvSSHKeyShow && env.Kind == domain.EnvLocal {
		return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("environment %s is local: it uses the SSH keys of this machine", env.Name))
	}
	var next string
	var err error
	switch p.Action {
	case rpc.EnvSSHKeyShow:
		if _, err := d.envs.PublicKey(env.Name); err != nil {
			return errorResponse(req.ID, rpc.CodeNotFound, err.Error())
		}
	case rpc.EnvSSHKeyMake:
		_, err = d.envs.MakeSSHKey(env.Name)
	case rpc.EnvSSHKeyRotate:
		next, err = d.envs.RotateSSHKey(env.Name)
	case rpc.EnvSSHKeyConfirm:
		err = d.envs.ConfirmSSHKey(env.Name)
	case rpc.EnvSSHKeyCancel:
		err = d.envs.CancelSSHKey(env.Name)
	case rpc.EnvSSHKeyImport:
		if strings.TrimSpace(p.PrivateKey) == "" {
			return errorResponse(req.ID, rpc.CodeBadRequest, "env.ssh_key import needs a private key")
		}
		_, err = d.envs.ImportSSHKey(env.Name, []byte(p.PrivateKey))
	default:
		return errorResponse(req.ID, rpc.CodeBadRequest, fmt.Sprintf("env.ssh_key: unknown action %q", p.Action))
	}
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	info := d.envInfo(env, mates)
	if next != "" && next != info.PublicKey {
		info.NewPublicKey = next
	}
	return result(req.ID, info)
}
