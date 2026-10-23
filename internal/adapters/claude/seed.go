package claude

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
)

const apiKeyTail = 20

func Seed(dir string, projects []string, apiKey string) (bool, error) {
	path := filepath.Join(dir, ".claude.json")
	original, err := os.ReadFile(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	doc := map[string]any{}
	if len(bytes.TrimSpace(original)) > 0 {
		if err := json.Unmarshal(original, &doc); err != nil {
			return false, fmt.Errorf("%s: %w", path, err)
		}
	}
	changed := setTrue(doc, "hasCompletedOnboarding")
	projs := childObject(doc, "projects")
	for _, p := range projects {
		changed = setTrue(childObject(projs, p), "hasTrustDialogAccepted") || changed
	}
	if apiKey != "" {
		tail := apiKey[max(0, len(apiKey)-apiKeyTail):]
		resp := childObject(doc, "customApiKeyResponses")
		approved, rejected := stringList(resp["approved"]), stringList(resp["rejected"])
		if !slices.Contains(approved, tail) {
			approved = append(approved, tail)
			changed = true
		}
		if i := slices.Index(rejected, tail); i >= 0 {
			rejected = slices.Delete(rejected, i, i+1)
			changed = true
		}
		resp["approved"], resp["rejected"] = approved, rejected
	}
	if !changed {
		return false, nil
	}
	if exists {
		if _, err := os.Stat(BackupPath(path)); errors.Is(err, os.ErrNotExist) {
			if err := os.WriteFile(BackupPath(path), original, 0o600); err != nil {
				return false, err
			}
		}
	}
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	if err := writeFile(path, append(out, '\n')); err != nil {
		return false, err
	}
	if !exists {
		return true, os.Chmod(path, 0o600)
	}
	return true, nil
}

func setTrue(doc map[string]any, key string) bool {
	if doc[key] == true {
		return false
	}
	doc[key] = true
	return true
}

func childObject(doc map[string]any, key string) map[string]any {
	child, ok := doc[key].(map[string]any)
	if !ok {
		child = map[string]any{}
		doc[key] = child
	}
	return child
}

func stringList(v any) []string {
	out := []string{}
	items, _ := v.([]any)
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
