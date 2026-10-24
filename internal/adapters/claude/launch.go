package claude

import (
	"path/filepath"
	"strings"

	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/domain"
)

type Adapter struct {
	Binary    string
	ConfigDir string
}

func (Adapter) Harness() domain.Harness { return domain.HarnessClaude }

func (a Adapter) Launch(req app.LaunchRequest) app.PaneSpec {
	bin := a.Binary
	if bin == "" {
		bin = "claude"
	}
	command := []string{bin}
	transcript := ""
	switch {
	case req.Resume != "":
		command = append(command, "--resume", req.Resume)
	case req.SessionID != "" && a.ConfigDir != "":
		command = append(command, "--session-id", req.SessionID)
		transcript = filepath.Join(a.ConfigDir, "projects", projectDir(req.Dir), req.SessionID+".jsonl")
	}
	if req.Model != "" {
		command = append(command, "--model", req.Model)
	}
	if req.Effort != "" {
		command = append(command, "--effort", req.Effort)
	}
	if req.SystemPrompt != "" {
		command = append(command, "--append-system-prompt", req.SystemPrompt)
	}
	if req.Prompt != "" {
		command = append(command, "--", req.Prompt)
	}
	return app.PaneSpec{Name: req.Name, Dir: req.Dir, Command: command, Transcript: transcript}
}

func projectDir(dir string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, dir)
}
