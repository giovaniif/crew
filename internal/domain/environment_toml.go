package domain

import (
	"fmt"
	"strings"
)

func tomlStrings(values []string) string {
	quoted := make([]string, len(values))
	for i, v := range values {
		quoted[i] = tomlString(v)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func EnvTOML(env Environment) string {
	var b strings.Builder
	b.WriteString("[[env]]\n")
	fmt.Fprintf(&b, "name = %s\n", tomlString(env.Name))
	fmt.Fprintf(&b, "kind = %s\n", tomlString(string(env.Kind)))
	if len(env.Parts) > 0 {
		parts := make([]string, len(env.Parts))
		for i, p := range env.Parts {
			parts[i] = string(p)
		}
		fmt.Fprintf(&b, "parts = %s\n", tomlStrings(parts))
	}
	if len(env.Extra) > 0 {
		fmt.Fprintf(&b, "extra = %s\n", tomlStrings(env.Extra))
	}
	return b.String()
}

func SetEnvBlock(src string, env Environment) string {
	return setBlock(src, "[[env]]", env.Name, EnvTOML(env))
}

func RemoveEnvBlock(src, name string) string {
	return removeBlock(src, "[[env]]", name)
}

func ValidateMateEnv(m Mate, envs []Environment) error {
	if m.Env == "" || m.Env == string(EnvLocal) {
		return nil
	}
	for _, e := range envs {
		if e.Name == m.Env {
			return nil
		}
	}
	return fmt.Errorf("mate %s: no environment %q", m.Name, m.Env)
}

func MatesUsingEnv(mates []Mate, env string) []string {
	var out []string
	for _, m := range mates {
		if m.Env == env {
			out = append(out, m.Name)
		}
	}
	return out
}
