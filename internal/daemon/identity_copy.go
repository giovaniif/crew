package daemon

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

type identityCopies struct {
	mu   sync.Mutex
	keys *domain.CopyKeys
}

func (c *identityCopies) begin(id string, key []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.keys == nil {
		c.keys = domain.NewCopyKeys()
	}
	c.keys.Begin(id, key, time.Now())
}

func (c *identityCopies) take(id string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.keys == nil {
		return nil, domain.ErrCopyUnknown
	}
	return c.keys.Take(id, time.Now())
}

func (d *Daemon) identityCopyBegin(req rpc.Request) *rpc.Response {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, "make the copy key: "+err.Error())
	}
	var id [12]byte
	if _, err := rand.Read(id[:]); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, "make the copy id: "+err.Error())
	}
	copyID := hex.EncodeToString(id[:])
	d.copies.begin(copyID, key.Bytes())
	return result(req.ID, rpc.IdentityCopyBegin{CopyID: copyID, PublicKey: base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())})
}

func (d *Daemon) identityExport(req rpc.Request) *rpc.Response {
	var p rpc.IdentityExportParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "identity.export needs a name and a public key")
	}
	if isYours(p.Name) {
		return errorResponse(req.ID, rpc.CodeBadRequest, "Your accounts stays on its machine: copy a separate identity")
	}
	env, err := d.envs.Get(p.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeNotFound, err.Error())
	}
	if env.Kind == domain.EnvLocal {
		return errorResponse(req.ID, rpc.CodeBadRequest, "only a separate identity can be copied")
	}
	pub, err := base64.StdEncoding.DecodeString(p.PublicKey)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "the public key is not base64")
	}
	values, err := d.envs.Secrets(env.Name)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, "read the secrets of "+env.Name)
	}
	gitName, gitEmail := d.envs.GitIdentity(env.Name)
	bundle := domain.IdentityBundle{
		Identity: domain.Environment{Name: env.Name, Label: env.Label, Kind: domain.EnvCustom, Parts: env.Parts, Extra: env.Extra},
		GitName:  gitName, GitEmail: gitEmail, Secrets: values,
	}
	sealed, err := domain.SealIdentityBundle(pub, bundle, rand.Reader)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "seal the bundle: the public key is not valid")
	}
	return result(req.ID, rpc.IdentityExport{Bundle: base64.StdEncoding.EncodeToString(sealed)})
}

func (d *Daemon) identityImport(req rpc.Request, mates []domain.Mate) *rpc.Response {
	var p rpc.IdentityImportParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "identity.import needs a copy_id and a bundle")
	}
	key, err := d.copies.take(p.CopyID)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeStale, err.Error())
	}
	sealed, err := base64.StdEncoding.DecodeString(p.Bundle)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, "the bundle is not base64")
	}
	b, err := domain.OpenIdentityBundle(key, sealed)
	if err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, domain.ErrCopyBundle.Error())
	}
	if isYours(b.Identity.Name) || d.envExists(b.Identity.Name) {
		return errorResponse(req.ID, rpc.CodeInUse, "this machine has an identity "+b.Identity.Name+" already")
	}
	env := domain.Environment{Name: b.Identity.Name, Label: b.Identity.Label, Kind: domain.EnvCustom, Parts: b.Identity.Parts, Extra: b.Identity.Extra}
	if err := domain.ValidateEnvironment(env); err != nil {
		return errorResponse(req.ID, rpc.CodeBadRequest, err.Error())
	}
	if err := d.envs.Save(env); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, err.Error())
	}
	if b.GitName != "" || b.GitEmail != "" {
		if err := d.envs.WriteGitConfig(env.Name, b.GitName, b.GitEmail); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, err.Error())
		}
	}
	for name, value := range b.Secrets {
		if err := d.envs.SetSecret(env.Name, name, value); err != nil {
			return errorResponse(req.ID, rpc.CodeFailed, "save the secret "+name)
		}
	}
	if _, err := d.envs.MakeSSHKey(env.Name); err != nil {
		return errorResponse(req.ID, rpc.CodeFailed, "make the SSH key: "+err.Error())
	}
	return d.envReload(req, env.Name, mates)
}
