package domain

import (
	"path/filepath"
	"slices"
	"strings"
)

type HooksMissing struct {
	Env     string  `json:"env"`
	Harness Harness `json:"harness"`
	File    string  `json:"file"`
	Reason  string  `json:"reason"`
}

func CheckHooks(env string, h Harness, s HarnessSetup, home string) (HooksMissing, bool) {
	if !s.SetUp || (s.Installed && s.Err == "") {
		return HooksMissing{}, false
	}
	file := s.File
	if home != "" && strings.HasPrefix(file, home+"/") {
		file = "~" + strings.TrimPrefix(file, home)
	}
	reason := "crew hooks are missing in " + file
	if s.Err != "" {
		reason = "crew can not read " + file + ": " + s.Err
	}
	return HooksMissing{Env: env, Harness: h, File: s.File, Reason: reason}, true
}

func EnvHarnessDir(env Environment, h Harness) string {
	part, ok := envHarnessParts[h]
	if !ok || env.Kind != EnvCustom || env.Home == "" || !slices.Contains(env.Parts, part) {
		return ""
	}
	return filepath.Join(env.Home, envParts[part].dir)
}
