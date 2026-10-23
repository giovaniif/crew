package codex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

const EnvProvider = "crew-openai-env"

const envProviderTable = `[model_providers.` + EnvProvider + `]
name = "OpenAI (env key)"
base_url = "https://api.openai.com/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`

type seedDoc struct {
	ModelProvider  string                    `toml:"model_provider"`
	ModelProviders map[string]toml.Primitive `toml:"model_providers"`
	Projects       map[string]toml.Primitive `toml:"projects"`
}

func Seed(dir string, projects []string) (bool, error) {
	path := filepath.Join(dir, "config.toml")
	original, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	var doc seedDoc
	if _, err := toml.Decode(string(original), &doc); err != nil {
		return false, fmt.Errorf("%s does not parse, so crew leaves it alone: %w", path, err)
	}
	text := string(original)
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	var tail strings.Builder
	if _, ok := doc.ModelProviders[EnvProvider]; !ok {
		tail.WriteString("\n" + envProviderTable)
	}
	for _, p := range projects {
		if _, ok := doc.Projects[p]; ok {
			continue
		}
		doc.Projects = ensure(doc.Projects)
		doc.Projects[p] = toml.Primitive{}
		fmt.Fprintf(&tail, "\n[projects.%s]\ntrust_level = \"trusted\"\n", tomlString(p))
	}
	head := ""
	if doc.ModelProvider == "" {
		head = "model_provider = \"" + EnvProvider + "\"\n"
	}
	if head == "" && tail.Len() == 0 {
		return false, nil
	}
	next := head + text + tail.String()
	if _, err := toml.Decode(next, &seedDoc{}); err != nil {
		return false, fmt.Errorf("%s: the merge does not parse: %w", path, err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	if exists {
		backup := fmt.Sprintf("%s.crew-%s.bak", path, time.Now().UTC().Format("20060102T150405.000000000Z"))
		if err := os.WriteFile(backup, original, 0o600); err != nil {
			return false, err
		}
	}
	tmp := path + ".crew-tmp"
	if err := os.WriteFile(tmp, []byte(next), 0o600); err != nil {
		return false, err
	}
	return true, os.Rename(tmp, path)
}

func ensure(m map[string]toml.Primitive) map[string]toml.Primitive {
	if m == nil {
		return map[string]toml.Primitive{}
	}
	return m
}

func tomlString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}
