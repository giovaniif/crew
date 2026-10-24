package domain

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

type EnvKind string

const (
	EnvLocal  EnvKind = "local"
	EnvCustom EnvKind = "custom"
)

type EnvPart string

const (
	EnvGit    EnvPart = "git"
	EnvSSH    EnvPart = "ssh"
	EnvGitHub EnvPart = "github"
	EnvClaude EnvPart = "claude"
	EnvCodex  EnvPart = "codex"
	EnvPi     EnvPart = "pi"
)

const EnvSSHKeyFile = "id_ed25519"

type Environment struct {
	Name    string    `json:"name"`
	Label   string    `json:"label,omitempty"`
	Kind    EnvKind   `json:"kind"`
	Parts   []EnvPart `json:"parts,omitempty"`
	Extra   []string  `json:"extra,omitempty"`
	Home    string    `json:"-"`
	Secrets string    `json:"-"`
}

type envPartSpec struct {
	dirVar  string
	dir     string
	secrets []string
}

var envPiKeys = []string{"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY"}

var envParts = map[EnvPart]envPartSpec{
	EnvGit:    {dirVar: "GIT_CONFIG_GLOBAL", dir: "gitconfig"},
	EnvSSH:    {dirVar: "GIT_SSH_COMMAND"},
	EnvGitHub: {dirVar: "GH_CONFIG_DIR", dir: "gh", secrets: []string{"GH_TOKEN"}},
	EnvClaude: {dirVar: "CLAUDE_CONFIG_DIR", dir: "claude", secrets: []string{"CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"}},
	EnvCodex:  {dirVar: "CODEX_HOME", dir: "codex", secrets: []string{"OPENAI_API_KEY"}},
	EnvPi:     {dirVar: "PI_CODING_AGENT_DIR", dir: "omp", secrets: envPiKeys},
}

var envHarnessParts = map[Harness]EnvPart{HarnessClaude: EnvClaude, HarnessCodex: EnvCodex, HarnessOmp: EnvPi}

func EnvPartForHarness(p EnvPart, harness Harness) bool {
	own, ok := envHarnessParts[harness]
	if harness == "" || !slices.Contains([]EnvPart{EnvClaude, EnvCodex, EnvPi}, p) {
		return true
	}
	return ok && own == p
}

func ValidEnvHarness(h Harness) bool {
	_, ok := envHarnessParts[h]
	return ok
}

var envPartOrder = []EnvPart{EnvGit, EnvSSH, EnvGitHub, EnvClaude, EnvCodex, EnvPi}

var envAllow = []string{"PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG", "TZ", "TMPDIR", "TMUX", "TMUX_PANE",
	"CREW_HOME", "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY"}

var (
	envDenyExact  = []string{"PATH", "HOME", "SSH_AUTH_SOCK"}
	envDenyPrefix = []string{"TMUX", "CREW_", "AGENTWS_", "LD_", "DYLD_"}
	envVarName    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

func ValidEnvName(name string) bool { return ValidMateName(name) }

func envManaged(name string) bool {
	for _, spec := range envParts {
		if spec.dirVar == name || slices.Contains(spec.secrets, name) {
			return true
		}
	}
	return false
}

func ValidateExtraVarName(name string) error {
	if !envVarName.MatchString(name) {
		return fmt.Errorf("%q is not a variable name", name)
	}
	up := strings.ToUpper(name)
	denied := slices.Contains(envDenyExact, up) || envManaged(up)
	for _, p := range envDenyPrefix {
		denied = denied || strings.HasPrefix(up, p)
	}
	if denied {
		return fmt.Errorf("crew does not let you set %s", name)
	}
	return nil
}

func ValidateEnvironment(env Environment) error {
	if !ValidEnvName(env.Name) {
		return fmt.Errorf("environment name %q: use lower case letters, digits, - and _", env.Name)
	}
	if env.Kind != EnvLocal && env.Kind != EnvCustom {
		return fmt.Errorf("environment %s: kind %q is not local or custom", env.Name, env.Kind)
	}
	if env.Kind == EnvLocal && len(env.Parts) > 0 {
		return fmt.Errorf("environment %s: a local environment has no parts", env.Name)
	}
	seen := map[string]bool{}
	for _, p := range env.Parts {
		if _, ok := envParts[p]; !ok {
			return fmt.Errorf("environment %s: unknown part %s", env.Name, p)
		}
		if seen[string(p)] {
			return fmt.Errorf("environment %s: part %s is there twice", env.Name, p)
		}
		seen[string(p)] = true
	}
	for _, x := range env.Extra {
		if err := ValidateExtraVarName(x); err != nil {
			return fmt.Errorf("environment %s: %w", env.Name, err)
		}
		if seen["$"+x] {
			return fmt.Errorf("environment %s: variable %s is there twice", env.Name, x)
		}
		seen["$"+x] = true
	}
	return nil
}

func EnvSecretNames(env Environment) []string {
	var out []string
	for _, p := range envPartOrder {
		if slices.Contains(env.Parts, p) {
			for _, s := range envParts[p].secrets {
				if !slices.Contains(out, s) {
					out = append(out, s)
				}
			}
		}
	}
	return append(out, env.Extra...)
}

func envAllowed(name string) bool {
	return slices.Contains(envAllow, name) || strings.HasPrefix(name, "LC_")
}

func BuildEnv(env Environment, harness Harness, secrets map[string]string, environ []string) []string {
	set := map[string]string{}
	var order []string
	put := func(k, v string) {
		if _, ok := set[k]; !ok {
			order = append(order, k)
		}
		set[k] = v
	}
	for _, kv := range environ {
		k, v, _ := strings.Cut(kv, "=")
		if env.Kind == EnvLocal || envAllowed(k) {
			put(k, v)
		}
	}
	if env.Kind == EnvCustom {
		for _, p := range envPartOrder {
			if !slices.Contains(env.Parts, p) || !EnvPartForHarness(p, harness) {
				continue
			}
			spec := envParts[p]
			if p == EnvSSH {
				put(spec.dirVar, "ssh -i '"+filepath.Join(env.Secrets, "ssh", EnvSSHKeyFile)+"' -o IdentitiesOnly=yes")
			} else {
				put(spec.dirVar, filepath.Join(env.Home, spec.dir))
			}
			for _, s := range spec.secrets {
				if v, ok := secrets[s]; ok && v != "" {
					put(s, v)
				}
			}
		}
	}
	extras := slices.Clone(env.Extra)
	slices.Sort(extras)
	applied := false
	for _, x := range extras {
		if v, ok := secrets[x]; ok && ValidateExtraVarName(x) == nil {
			put(x, v)
			applied = true
		}
	}
	if env.Kind == EnvLocal && !applied {
		return environ
	}
	out := make([]string, 0, len(order))
	for _, k := range order {
		out = append(out, k+"="+set[k])
	}
	return out
}
