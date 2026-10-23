package omp

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func Seed(dir string) (bool, error) {
	path := filepath.Join(dir, "config.yml")
	original, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	text := string(original)
	if strings.Contains(text, "setupWizard:") {
		return false, nil
	}
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	if text == "" {
		lines = nil
	}
	at := -1
	for i, l := range lines {
		if strings.TrimRight(l, " \t") == "startup:" {
			at = i
			break
		}
	}
	if at < 0 {
		lines = append(lines, "startup:", "  setupWizard: false")
	} else {
		indent := "  "
		if at+1 < len(lines) {
			next := lines[at+1]
			if trimmed := strings.TrimLeft(next, " "); trimmed != "" && len(trimmed) < len(next) {
				indent = next[:len(next)-len(trimmed)]
			}
		}
		lines = append(lines[:at+1], append([]string{indent + "setupWizard: false"}, lines[at+1:]...)...)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	if exists {
		if err := os.WriteFile(path+".crew-backup", original, 0o600); err != nil {
			return false, err
		}
	}
	return true, writeAtomic(path, []byte(strings.Join(lines, "\n")+"\n"))
}
