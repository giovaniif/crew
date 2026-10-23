package app

import "github.com/giovaniif/crew/internal/domain"

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
}
