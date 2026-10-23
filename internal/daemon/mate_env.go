package daemon

import (
	"github.com/BurntSushi/toml"

	"github.com/giovaniif/crew/internal/domain"
)

func parseEnvNames(text string) []domain.Environment {
	var doc struct {
		Env []struct {
			Name string `toml:"name"`
		} `toml:"env"`
	}
	if _, err := toml.Decode(text, &doc); err != nil {
		return nil
	}
	out := make([]domain.Environment, len(doc.Env))
	for i, e := range doc.Env {
		out[i] = domain.Environment{Name: e.Name}
	}
	return out
}
