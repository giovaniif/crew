package domain

import (
	"path"
	"strings"
)

func ClaudeTrusts(accepted map[string]bool, dir string) bool {
	if !strings.HasPrefix(dir, "/") {
		return false
	}
	for d := path.Clean(dir); ; d = path.Dir(d) {
		if accepted[d] {
			return true
		}
		if d == "/" {
			return false
		}
	}
}
