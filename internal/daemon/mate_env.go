package daemon

import (
	"github.com/BurntSushi/toml"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
)

func WithEnvLauncher(crew string) Option {
	return func(d *Daemon) { d.envLauncher = crew }
}

type envHarness struct {
	app.HarnessAdapter
	crew string
	env  string
}

func (h envHarness) Launch(req app.LaunchRequest) app.PaneSpec {
	spec := h.HarnessAdapter.Launch(req)
	spec.Command = domain.EnvLaunchCommand(h.crew, h.env, h.Harness(), spec.Command)
	spec.Transcript = ""
	return spec
}

func (d *Daemon) envAdapter(adapter app.HarnessAdapter, env string) app.HarnessAdapter {
	if env == "" {
		return adapter
	}
	crew := d.envLauncher
	if crew == "" {
		crew = "crew"
	}
	return envHarness{HarnessAdapter: adapter, crew: crew, env: env}
}

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
