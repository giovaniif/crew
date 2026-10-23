package app

import (
	"time"

	"github.com/giovaniif/crew/internal/domain"
)

type EnvironmentStore interface {
	List() ([]domain.Environment, error)
	Get(name string) (domain.Environment, error)
	Save(env domain.Environment) error
	Delete(name string) error
	SetSecret(env, name, value string) error
	ClearSecret(env, name string) error
	SecretsSet(env string) map[string]bool
	Secrets(env string) (map[string]string, error)
	WriteGitConfig(env, name, email string) error
	MakeSSHKey(env string) (string, error)
	ImportSSHKey(env string, private []byte) (string, error)
	RotateSSHKey(env string) (string, error)
	ConfirmSSHKey(env string) error
	PublicKey(env string) (string, error)
	NewPublicKey(env string) (string, error)
	CancelSSHKey(env string) error
	KeyCreated(env string) (time.Time, error)
	GitIdentity(env string) (name, email string)
	CodexLogin(env string) bool
}

type LocalFacts struct {
	GitName    string
	GitEmail   string
	SSHAgent   bool
	SSHKeys    int
	GitHub     bool
	GitHubUser string
	Claude     bool
	Codex      bool
	Pi         bool
}

type LocalProbe interface {
	Local() LocalFacts
}
