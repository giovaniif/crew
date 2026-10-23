package main

import (
	"errors"
	"path/filepath"
	"slices"
	"strings"

	"github.com/giovaniif/crew/internal/adapters/claude"
	"github.com/giovaniif/crew/internal/adapters/codex"
	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/adapters/omp"
	"github.com/giovaniif/crew/internal/domain"
)

func seedEnv(store envstore.Store, name string, environ []string, cwd, self string) error {
	env, err := store.Get(name)
	if err != nil || env.Kind != domain.EnvCustom || env.Home == "" {
		return err
	}
	get := func(key string) string {
		for _, kv := range environ {
			if k, v, ok := strings.Cut(kv, "="); ok && k == key {
				return v
			}
		}
		return ""
	}
	projects := []string{cwd}
	if real, err := filepath.EvalSymlinks(cwd); err == nil && real != cwd {
		projects = append(projects, real)
	}
	var errs []error
	if dir := get("CLAUDE_CONFIG_DIR"); slices.Contains(env.Parts, domain.EnvClaude) && dir != "" {
		errs = append(errs, claude.Setup(filepath.Join(dir, "settings.json"), self))
		_, err := claude.Seed(dir, projects, get("ANTHROPIC_API_KEY"))
		errs = append(errs, err)
	}
	if dir := get("CODEX_HOME"); slices.Contains(env.Parts, domain.EnvCodex) && dir != "" {
		_, err := codex.Setup(codex.SetupConfig{Dir: dir, Command: self})
		errs = append(errs, err)
		_, err = codex.Seed(dir, projects)
		errs = append(errs, err)
	}
	if dir := get("PI_CODING_AGENT_DIR"); slices.Contains(env.Parts, domain.EnvPi) && dir != "" {
		_, err := omp.Setup(omp.SetupConfig{Dir: dir, Command: self})
		errs = append(errs, err)
		_, err = omp.Seed(dir)
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}
