package main

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
)

type staleProc struct {
	PID     int
	Command string
}

func staleCrewProcs(procDir string) []staleProc {
	entries, err := os.ReadDir(procDir)
	if err != nil {
		return nil
	}
	var out []staleProc
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		exe, err := os.Readlink(filepath.Join(procDir, e.Name(), "exe"))
		if err != nil || !domain.ReplacedBinary(exe) || filepath.Base(strings.TrimSuffix(exe, " (deleted)")) != "crew" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(procDir, e.Name(), "cmdline"))
		if err != nil {
			continue
		}
		args := strings.Split(string(bytes.TrimRight(raw, "\x00")), "\x00")
		cmd := "crew"
		if len(args) > 1 {
			cmd += " " + args[1]
		}
		out = append(out, staleProc{PID: pid, Command: cmd})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PID < out[j].PID })
	return out
}
