package omp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeedConfig(t *testing.T) {
	for name, tc := range map[string]struct{ before, want string }{
		"fresh":               {"", "startup:\n  setupWizard: false\n"},
		"other keys":          {"theme: dark\n", "theme: dark\nstartup:\n  setupWizard: false\n"},
		"no final new line":   {"theme: dark", "theme: dark\nstartup:\n  setupWizard: false\n"},
		"startup block":       {"startup:\n    quiet: true\ntheme: dark\n", "startup:\n    setupWizard: false\n    quiet: true\ntheme: dark\n"},
		"empty startup":       {"startup:\ntheme: dark\n", "startup:\n  setupWizard: false\ntheme: dark\n"},
		"user set it already": {"startup:\n  setupWizard: true\n", "startup:\n  setupWizard: true\n"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "config.yml")
			if tc.before != "" {
				if err := os.WriteFile(path, []byte(tc.before), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			changed, err := Seed(dir)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := os.ReadFile(path)
			if string(got) != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
			if changed != (tc.before != tc.want) {
				t.Errorf("changed = %v", changed)
			}
			backup, err := os.ReadFile(path + ".crew-backup")
			if changed && tc.before != "" && string(backup) != tc.before {
				t.Errorf("backup = %q, %v", backup, err)
			}
			again, err := Seed(dir)
			if err != nil || again {
				t.Errorf("second run: changed=%v err=%v", again, err)
			}
		})
	}
}
