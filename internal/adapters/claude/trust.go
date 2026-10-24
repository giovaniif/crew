package claude

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/giovaniif/crew/internal/domain"
)

const trustKey = "hasTrustDialogAccepted"

type Trust struct {
	File string
}

func TrustFile(env func(string) string) string {
	if dir := env("CLAUDE_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, ".claude.json")
	}
	return filepath.Join(env("HOME"), ".claude.json")
}

func (t Trust) read() (map[string]json.RawMessage, []byte, error) {
	b, err := os.ReadFile(t.File)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]json.RawMessage{}, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(b, &top); err != nil {
		return nil, nil, fmt.Errorf("%s: %w", t.File, err)
	}
	if top == nil {
		top = map[string]json.RawMessage{}
	}
	return top, b, nil
}

func projects(top map[string]json.RawMessage) (map[string]map[string]json.RawMessage, error) {
	out := map[string]map[string]json.RawMessage{}
	if raw, ok := top["projects"]; ok {
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func accepted(ps map[string]map[string]json.RawMessage) map[string]bool {
	out := map[string]bool{}
	for dir, p := range ps {
		var ok bool
		if json.Unmarshal(p[trustKey], &ok) == nil && ok {
			out[dir] = true
		}
	}
	return out
}

func (t Trust) Trusted(dir string) (bool, error) {
	top, _, err := t.read()
	if err != nil {
		return false, err
	}
	ps, err := projects(top)
	if err != nil {
		return false, fmt.Errorf("%s: %w", t.File, err)
	}
	return domain.ClaudeTrusts(accepted(ps), dir), nil
}

func (t Trust) TrustDir(dir string) error {
	top, old, err := t.read()
	if err != nil {
		return err
	}
	ps, err := projects(top)
	if err != nil {
		return fmt.Errorf("%s: %w", t.File, err)
	}
	if domain.ClaudeTrusts(accepted(ps), dir) {
		return nil
	}
	dir = filepath.Clean(dir)
	if ps[dir] == nil {
		ps[dir] = map[string]json.RawMessage{}
	}
	ps[dir][trustKey] = json.RawMessage("true")
	raw, err := json.Marshal(ps)
	if err != nil {
		return err
	}
	top["projects"] = raw
	body, err := json.MarshalIndent(top, "", "  ")
	if err != nil {
		return err
	}
	mode := fs.FileMode(0o600)
	if info, err := os.Stat(t.File); err == nil {
		mode = info.Mode().Perm()
	}
	if err := os.MkdirAll(filepath.Dir(t.File), 0o700); err != nil {
		return err
	}
	if old != nil {
		backup := t.File + ".crew-" + time.Now().UTC().Format("20060102T150405.000000000") + ".bak"
		if err := os.WriteFile(backup, old, 0o600); err != nil {
			return err
		}
	}
	tmp := t.File + ".crew-tmp"
	if err := os.WriteFile(tmp, body, mode); err != nil {
		return err
	}
	return os.Rename(tmp, t.File)
}
