package daemon

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"

	"github.com/BurntSushi/toml"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func WithMachine(name string) Option {
	return func(d *Daemon) {
		d.machineName = name
	}
}

func (d *Daemon) loadMachine() error {
	if d.machineName == "" || d.cfg.path == "" {
		return nil
	}
	d.cfg.mu.Lock()
	defer d.cfg.mu.Unlock()
	id, err := d.ensureMachineID()
	if err != nil {
		return fmt.Errorf("machine id in %s: %w", d.cfg.path, err)
	}
	d.machine = rpc.Machine{ID: id, Name: d.machineName}
	return nil
}

func machineIDOf(src string) (string, error) {
	var tree struct {
		Machine struct {
			ID string `toml:"id"`
		} `toml:"machine"`
	}
	if _, err := toml.Decode(src, &tree); err != nil {
		return "", err
	}
	return tree.Machine.ID, nil
}

func (d *Daemon) ensureMachineID() (string, error) {
	src, err := readConfig(d.cfg.path)
	if err != nil {
		return "", err
	}
	id, err := machineIDOf(src)
	if err != nil || id != "" {
		return id, err
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	id = hex.EncodeToString(b[:])
	next := domain.SetTOMLValue(src, "machine.id", strconv.Quote(id))
	if got, err := machineIDOf(next); err != nil || got != id {
		return "", fmt.Errorf("crew cannot add [machine] id; add it by hand")
	}
	return id, d.replaceConfig(src, next)
}

func WithTmuxSocket(socket string) Option {
	return func(d *Daemon) {
		d.tmuxSocket = socket
	}
}
