package daemon

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"

	"github.com/giovaniif/crew/internal/domain"
)

func oldEnvs(src string) ([]domain.Environment, error) {
	var doc struct {
		Env []struct {
			Name  string   `toml:"name"`
			Kind  string   `toml:"kind"`
			Parts []string `toml:"parts"`
			Extra []string `toml:"extra"`
		} `toml:"env"`
	}
	if _, err := toml.Decode(src, &doc); err != nil {
		return nil, err
	}
	out := make([]domain.Environment, 0, len(doc.Env))
	for _, e := range doc.Env {
		env := domain.Environment{Name: e.Name, Kind: domain.EnvKind(e.Kind), Extra: e.Extra}
		for _, p := range e.Parts {
			env.Parts = append(env.Parts, domain.EnvPart(p))
		}
		out = append(out, env)
	}
	return out, nil
}

type dirMove struct{ from, to string }

func identityDirMoves(home string, moves []domain.IdentityMove) []dirMove {
	var out []dirMove
	for _, m := range moves {
		out = append(out,
			dirMove{filepath.Join(home, "secrets", "env", m.From), filepath.Join(home, "secrets", "identity", m.To)},
			dirMove{filepath.Join(home, "envs", m.From), filepath.Join(home, "identities", m.To)})
	}
	return out
}

func moveDirs(moves []dirMove) error {
	var done []dirMove
	undo := func() {
		for i := len(done) - 1; i >= 0; i-- {
			_ = os.Rename(done[i].to, done[i].from)
		}
	}
	for _, m := range moves {
		if _, err := os.Stat(m.from); errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if _, err := os.Stat(m.to); err == nil {
			undo()
			return fmt.Errorf("%s is there already", m.to)
		}
		if err := os.MkdirAll(filepath.Dir(m.to), 0o700); err != nil {
			undo()
			return err
		}
		if err := os.Rename(m.from, m.to); err != nil {
			undo()
			return err
		}
		done = append(done, m)
	}
	return nil
}

func (d *Daemon) migrateIdentities() {
	if d.machine.ID == "" {
		return
	}
	d.cfg.mu.Lock()
	defer d.cfg.mu.Unlock()
	if err := d.migrateIdentitiesLocked(); err != nil {
		log.Printf("[identity] migration of %s stopped, the old files stay: %v", d.cfg.path, err)
	}
}

func (d *Daemon) migrateIdentitiesLocked() error {
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return err
	}
	envs, err := oldEnvs(src)
	if err != nil {
		return err
	}
	mates, _ := parseMates(src, d.cfg.path)
	plan := domain.PlanIdentityMigration(src, envs, mates, d.machine.ID)
	if !plan.Changed {
		return nil
	}
	if _, err := oldEnvs(plan.Text); err != nil {
		return fmt.Errorf("the new config does not parse: %w", err)
	}
	if err := d.backupConfig(src); err != nil {
		return err
	}
	moves := identityDirMoves(filepath.Dir(d.cfg.path), plan.Moves)
	if err := moveDirs(moves); err != nil {
		return err
	}
	if err := d.writeConfigFile(plan.Text); err != nil {
		var back []dirMove
		for _, m := range moves {
			back = append(back, dirMove{m.to, m.from})
		}
		_ = moveDirs(back)
		return err
	}
	return nil
}
