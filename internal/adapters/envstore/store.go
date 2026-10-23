package envstore

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/BurntSushi/toml"

	"github.com/giovaniif/crew/internal/domain"
)

type Store struct {
	Home string
}

const newKeySuffix = ".new"

var partDirs = map[domain.EnvPart]string{
	domain.EnvGitHub: "gh",
	domain.EnvClaude: "claude",
	domain.EnvCodex:  "codex",
	domain.EnvPi:     "omp",
}

type envDoc struct {
	Name  string   `toml:"name"`
	Kind  string   `toml:"kind"`
	Parts []string `toml:"parts"`
	Extra []string `toml:"extra"`
}

type configDoc struct {
	Env  []envDoc `toml:"env"`
	Mate []struct {
		Name string `toml:"name"`
		Env  string `toml:"env"`
	} `toml:"mate"`
}

func (s Store) configPath() string { return filepath.Join(s.Home, "config.toml") }

func (s Store) envHome(name string) string { return filepath.Join(s.Home, "envs", name) }

func (s Store) secretDir(name string) string { return filepath.Join(s.Home, "secrets", "env", name) }

func (s Store) keyPath(name string) string {
	return filepath.Join(s.secretDir(name), "ssh", domain.EnvSSHKeyFile)
}

func (s Store) read() (string, configDoc, error) {
	var doc configDoc
	b, err := os.ReadFile(s.configPath())
	if errors.Is(err, fs.ErrNotExist) {
		return "", doc, nil
	}
	if err != nil {
		return "", doc, err
	}
	if _, err := toml.Decode(string(b), &doc); err != nil {
		return "", doc, fmt.Errorf("%s does not parse, so crew leaves it alone: %w", s.configPath(), err)
	}
	return string(b), doc, nil
}

func (s Store) fill(d envDoc) domain.Environment {
	env := domain.Environment{Name: d.Name, Kind: domain.EnvKind(d.Kind), Extra: d.Extra, Home: s.envHome(d.Name), Secrets: s.secretDir(d.Name)}
	for _, p := range d.Parts {
		env.Parts = append(env.Parts, domain.EnvPart(p))
	}
	return env
}

func (s Store) List() ([]domain.Environment, error) {
	_, doc, err := s.read()
	if err != nil {
		return nil, err
	}
	out := make([]domain.Environment, 0, len(doc.Env))
	for _, d := range doc.Env {
		out = append(out, s.fill(d))
	}
	return out, nil
}

func (s Store) Get(name string) (domain.Environment, error) {
	list, err := s.List()
	if err != nil {
		return domain.Environment{}, err
	}
	for _, env := range list {
		if env.Name == name {
			return env, nil
		}
	}
	if name == "" || name == string(domain.EnvLocal) {
		return domain.Environment{Name: string(domain.EnvLocal), Kind: domain.EnvLocal}, nil
	}
	return domain.Environment{}, fmt.Errorf("no environment %q", name)
}

func (s Store) Save(env domain.Environment) error {
	if err := domain.ValidateEnvironment(env); err != nil {
		return err
	}
	src, _, err := s.read()
	if err != nil {
		return err
	}
	if old, err := s.Get(env.Name); err == nil && old.Home != "" && old.Kind != env.Kind {
		return fmt.Errorf("environment %s: the kind is fixed at %s", env.Name, old.Kind)
	}
	if err := s.writeConfig(src, domain.SetEnvBlock(src, env)); err != nil {
		return err
	}
	dirs := []string{s.envHome(env.Name), s.secretDir(env.Name)}
	for _, p := range env.Parts {
		if d, ok := partDirs[p]; ok {
			dirs = append(dirs, filepath.Join(s.envHome(env.Name), d))
		}
	}
	for _, d := range dirs {
		if err := privateDir(d); err != nil {
			return err
		}
	}
	return nil
}

func (s Store) Delete(name string) error {
	src, doc, err := s.read()
	if err != nil {
		return err
	}
	if _, err := s.Get(name); err != nil || !slices.ContainsFunc(doc.Env, func(d envDoc) bool { return d.Name == name }) {
		return fmt.Errorf("no environment %q", name)
	}
	var users []string
	for _, m := range doc.Mate {
		if m.Env == name {
			users = append(users, m.Name)
		}
	}
	if len(users) > 0 {
		return fmt.Errorf("environment %s is used by mate %s", name, strings.Join(users, ", "))
	}
	if err := s.writeConfig(src, domain.RemoveEnvBlock(src, name)); err != nil {
		return err
	}
	if err := os.RemoveAll(s.secretDir(name)); err != nil {
		return err
	}
	return os.RemoveAll(s.envHome(name))
}

func (s Store) SetSecret(name, key, value string) error {
	env, err := s.Get(name)
	if err != nil {
		return err
	}
	if !slices.Contains(domain.EnvSecretNames(env), key) {
		if err := domain.ValidateExtraVarName(key); err != nil {
			return fmt.Errorf("environment %s: %w", name, err)
		}
		if env.Home == "" {
			return fmt.Errorf("environment %s: create it first", name)
		}
		env.Extra = append(env.Extra, key)
		if err := s.Save(env); err != nil {
			return err
		}
	}
	if err := privateDir(s.secretDir(name)); err != nil {
		return err
	}
	return writePrivate(filepath.Join(s.secretDir(name), key), []byte(value))
}

func (s Store) ClearSecret(name, key string) error {
	if !s.knownSecret(name, key) {
		return fmt.Errorf("environment %s has no secret %s", name, key)
	}
	err := os.Remove(filepath.Join(s.secretDir(name), key))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (s Store) knownSecret(name, key string) bool {
	env, err := s.Get(name)
	return err == nil && slices.Contains(domain.EnvSecretNames(env), key)
}

func (s Store) SecretsSet(name string) map[string]bool {
	out := map[string]bool{}
	env, err := s.Get(name)
	if err != nil || env.Home == "" {
		return out
	}
	for _, key := range domain.EnvSecretNames(env) {
		info, err := os.Stat(filepath.Join(env.Secrets, key))
		out[key] = err == nil && info.Mode().IsRegular()
	}
	return out
}

func (s Store) Secrets(name string) (map[string]string, error) {
	env, err := s.Get(name)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	if env.Home == "" {
		return out, nil
	}
	for _, key := range domain.EnvSecretNames(env) {
		b, err := os.ReadFile(filepath.Join(env.Secrets, key))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("environment %s: read %s: %w", name, key, err)
		}
		out[key] = string(b)
	}
	return out, nil
}

func (s Store) WriteGitConfig(name, user, email string) error {
	if _, err := s.Get(name); err != nil {
		return err
	}
	for _, v := range []string{user, email} {
		if strings.ContainsAny(v, "\n\r\x00") {
			return fmt.Errorf("environment %s: the git identity cannot have a new line", name)
		}
	}
	quote := func(v string) string {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v) + `"`
	}
	text := "[user]\n\tname = " + quote(user) + "\n\temail = " + quote(email) + "\n"
	if err := privateDir(s.envHome(name)); err != nil {
		return err
	}
	return writePrivate(filepath.Join(s.envHome(name), "gitconfig"), []byte(text))
}

func (s Store) PublicKey(name string) (string, error) {
	if !domain.ValidEnvName(name) {
		return "", fmt.Errorf("no environment %q", name)
	}
	b, err := os.ReadFile(s.keyPath(name) + ".pub")
	if err != nil {
		return "", fmt.Errorf("environment %s has no SSH key", name)
	}
	return strings.TrimSpace(string(b)), nil
}

func (s Store) MakeSSHKey(name string) (string, error) {
	if pub, err := s.PublicKey(name); err == nil {
		return pub, nil
	}
	return s.newKey(name, s.keyPath(name))
}

func (s Store) RotateSSHKey(name string) (string, error) {
	if _, err := s.PublicKey(name); err != nil {
		return s.MakeSSHKey(name)
	}
	next := s.keyPath(name) + newKeySuffix
	_ = os.Remove(next)
	_ = os.Remove(next + ".pub")
	return s.newKey(name, next)
}

func (s Store) ConfirmSSHKey(name string) error {
	key := s.keyPath(name)
	if _, err := os.Stat(key + newKeySuffix); err != nil {
		return fmt.Errorf("environment %s has no new SSH key to confirm", name)
	}
	if err := os.Rename(key+newKeySuffix+".pub", key+".pub"); err != nil {
		return err
	}
	return os.Rename(key+newKeySuffix, key)
}

func (s Store) ImportSSHKey(name string, private []byte) (string, error) {
	if _, err := s.Get(name); err != nil {
		return "", err
	}
	dir := filepath.Dir(s.keyPath(name))
	if err := privateDir(dir); err != nil {
		return "", err
	}
	tmp := filepath.Join(dir, ".import")
	if err := writePrivate(tmp, private); err != nil {
		return "", err
	}
	defer func() { _ = os.Remove(tmp) }()
	out, err := exec.Command("ssh-keygen", "-y", "-f", tmp).Output()
	if err != nil {
		return "", fmt.Errorf("environment %s: the key is not a private SSH key without a passphrase", name)
	}
	pub := strings.TrimSpace(string(out))
	if err := writePrivate(s.keyPath(name)+".pub", []byte(pub+"\n")); err != nil {
		return "", err
	}
	return pub, os.Rename(tmp, s.keyPath(name))
}

func (s Store) newKey(name, path string) (string, error) {
	if _, err := s.Get(name); err != nil {
		return "", err
	}
	if err := privateDir(filepath.Dir(path)); err != nil {
		return "", err
	}
	cmd := exec.Command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "crew-"+name, "-f", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ssh-keygen: %v: %s", err, strings.TrimSpace(stderr.String()))
	}
	b, err := os.ReadFile(path + ".pub")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func (s Store) writeConfig(src, next string) error {
	if next == src {
		return nil
	}
	path := s.configPath()
	mode := fs.FileMode(0o600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
		backup := path + ".crew-" + time.Now().UTC().Format("20060102T150405.000000000Z") + ".bak"
		if err := os.WriteFile(backup, []byte(src), 0o600); err != nil {
			return fmt.Errorf("back up %s: %w", path, err)
		}
	}
	if err := os.MkdirAll(s.Home, 0o700); err != nil {
		return err
	}
	return writeFile(path, []byte(next), mode)
}

func privateDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return os.Chmod(dir, 0o700)
}

func writePrivate(path string, data []byte) error {
	return writeFile(path, data, 0o600)
}

func writeFile(path string, data []byte, mode fs.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
