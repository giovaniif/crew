package envstore

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"

	_ "modernc.org/sqlite"
)

type Probe struct {
	Home string
	Env  func(string) string
	Run  func(name string, args ...string) ([]byte, int, error)
}

const probeTimeout = 3 * time.Second

func NewProbe() Probe {
	home, _ := os.UserHomeDir()
	return Probe{Home: home, Env: os.Getenv, Run: runProbe}
}

func runProbe(name string, args ...string) ([]byte, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return out, exit.ExitCode(), nil
	}
	if err != nil {
		return nil, -1, err
	}
	return out, 0, nil
}

var ghAccount = regexp.MustCompile(`Logged in to \S+ account (\S+)`)

func (p Probe) Local() app.LocalFacts {
	var f app.LocalFacts
	f.GitName = p.output("git", "config", "--global", "user.name")
	f.GitEmail = p.output("git", "config", "--global", "user.email")
	if p.Env("SSH_AUTH_SOCK") != "" {
		f.SSHAgent = true
		if out, code, err := p.Run("ssh-add", "-l"); err == nil && code == 0 {
			f.SSHKeys = len(strings.Split(strings.TrimSpace(string(out)), "\n"))
		}
	}
	out, code, err := p.Run("gh", "auth", "status", "--active", "--hostname", "github.com")
	if err == nil && code == 0 {
		f.GitHub = true
		if m := ghAccount.FindStringSubmatch(string(out)); m != nil {
			f.GitHubUser = m[1]
		}
	}
	f.GitHub = f.GitHub || p.Env("GH_TOKEN") != "" || p.Env("GITHUB_TOKEN") != ""
	f.Claude = p.anyVar("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY") || exists(filepath.Join(p.dir("CLAUDE_CONFIG_DIR", ".claude"), ".credentials.json")) || p.claudeKeychain()
	f.Codex = p.anyVar("OPENAI_API_KEY") || exists(filepath.Join(p.dir("CODEX_HOME", ".codex"), "auth.json"))
	f.Pi = p.anyVar(domain.EnvSecretNames(domain.Environment{Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvPi}})...) || piLogin(filepath.Join(p.dir("PI_CODING_AGENT_DIR", filepath.Join(".omp", "agent")), "agent.db"))
	return f
}

func piLogin(path string) bool {
	if !exists(path) {
		return false
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return false
	}
	defer func() { _ = db.Close() }()
	var one int
	return db.QueryRow("SELECT 1 FROM auth_credentials WHERE disabled_cause IS NULL LIMIT 1").Scan(&one) == nil
}

func (p Probe) output(name string, args ...string) string {
	out, code, err := p.Run(name, args...)
	if err != nil || code != 0 {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (p Probe) claudeKeychain() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	_, code, err := p.Run("security", "find-generic-password", "-s", "Claude Code-credentials")
	return err == nil && code == 0
}

func (p Probe) anyVar(names ...string) bool {
	for _, n := range names {
		if p.Env(n) != "" {
			return true
		}
	}
	return false
}

func (p Probe) dir(variable, rel string) string {
	if d := p.Env(variable); d != "" {
		return d
	}
	return filepath.Join(p.Home, rel)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
