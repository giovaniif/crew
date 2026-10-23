package rpc

import "github.com/giovaniif/crew/internal/domain"

const (
	MethodEnvList   = "env.list"
	MethodEnvShow   = "env.show"
	MethodEnvCreate = "env.create"
	MethodEnvSet    = "env.set"
	MethodEnvUnset  = "env.unset"
	MethodEnvDelete = "env.delete"
	MethodEnvSSHKey = "env.ssh_key"
)

const (
	EnvSSHKeyShow    = ""
	EnvSSHKeyMake    = "make"
	EnvSSHKeyRotate  = "rotate"
	EnvSSHKeyConfirm = "confirm"
	EnvSSHKeyImport  = "import"
	EnvSSHKeyCancel  = "cancel"
)

type EnvSecret struct {
	Name string `json:"name"`
	Set  bool   `json:"set"`
}

type EnvInfo struct {
	Name         string           `json:"name"`
	Kind         domain.EnvKind   `json:"kind"`
	Parts        []domain.EnvPart `json:"parts"`
	Secrets      []EnvSecret      `json:"secrets"`
	PublicKey    string           `json:"public_key,omitempty"`
	NewPublicKey string           `json:"new_public_key,omitempty"`
	KeyCreated   string           `json:"key_created,omitempty"`
	GitName      string           `json:"git_name,omitempty"`
	GitEmail     string           `json:"git_email,omitempty"`
	CodexLogin   bool             `json:"codex_login,omitempty"`
	UsedBy       []string         `json:"used_by"`
	Local        *EnvLocal        `json:"local,omitempty"`
}

type EnvLocal struct {
	GitName    string `json:"git_name"`
	GitEmail   string `json:"git_email"`
	SSHAgent   bool   `json:"ssh_agent"`
	SSHKeys    int    `json:"ssh_keys"`
	GitHub     bool   `json:"github"`
	GitHubUser string `json:"github_user"`
	Claude     bool   `json:"claude"`
	Codex      bool   `json:"codex"`
	Pi         bool   `json:"pi"`
}

type EnvList struct {
	Envs []EnvInfo `json:"envs"`
}

type EnvNameParams struct {
	Name string `json:"name"`
}

type EnvCreateParams struct {
	Name     string           `json:"name"`
	Kind     domain.EnvKind   `json:"kind"`
	Parts    []domain.EnvPart `json:"parts,omitempty"`
	GitName  string           `json:"git_name,omitempty"`
	GitEmail string           `json:"git_email,omitempty"`
}

type EnvSetParams struct {
	Name     string            `json:"name"`
	Parts    *[]domain.EnvPart `json:"parts,omitempty"`
	GitName  string            `json:"git_name,omitempty"`
	GitEmail string            `json:"git_email,omitempty"`
	Secret   string            `json:"secret,omitempty"`
	Value    string            `json:"value,omitempty"`
}

type EnvUnsetParams struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

type EnvSSHKeyParams struct {
	Name       string `json:"name"`
	Action     string `json:"action,omitempty"`
	PrivateKey string `json:"private_key,omitempty"`
}
