package domain

import (
	"slices"
	"strconv"
)

func ExportableMate(m Mate) Mate {
	return Mate{
		Name: m.Name, Prompt: m.Prompt, Agent: m.Agent, Model: m.Model, Effort: m.Effort, Repos: m.Repos,
		Avatar: m.Avatar, Color: m.Color, Tone: m.Tone, NoMemory: m.NoMemory, Enabled: true,
	}
}

func MateImportName(name string, used []string) string {
	if !slices.Contains(used, name) {
		return name
	}
	for n := 2; ; n++ {
		suffix := "-" + strconv.Itoa(n)
		base := name
		if len(base)+len(suffix) > mateNameMax {
			base = base[:mateNameMax-len(suffix)]
		}
		if next := base + suffix; !slices.Contains(used, next) {
			return next
		}
	}
}
