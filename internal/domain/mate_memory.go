package domain

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const MateMemoryLimit = 8192

func CheckMateMemory(text string) error {
	if len(text) > MateMemoryLimit {
		return fmt.Errorf("the memory is %d bytes; the limit is %d bytes", len(text), MateMemoryLimit)
	}
	return nil
}

func mateMemoryTail(memory string) (string, bool) {
	if len(memory) <= MateMemoryLimit {
		return memory, false
	}
	cut := len(memory) - MateMemoryLimit
	for cut < len(memory) && !utf8.RuneStart(memory[cut]) {
		cut++
	}
	return memory[cut:], true
}

func MateSystemPrompt(m Mate, memory, path string) string {
	var b strings.Builder
	b.WriteString(strings.TrimRight(m.Prompt, "\n"))
	if tone := MateToneSentences(m.Tone); len(tone) > 0 {
		b.WriteString("\n\n" + strings.Join(tone, "\n"))
	}
	if m.NoMemory {
		return b.String() + "\n"
	}
	b.WriteString("\n\n## Your memory\n\n")
	b.WriteString("You are the mate " + m.Name + ". Your memory file is " + path + ". It continues across your conversations. ")
	b.WriteString("Add short notes to it when you learn something that a later conversation needs: decisions, preferences of the owner and facts about the repos. ")
	fmt.Fprintf(&b, "Keep the file under %d bytes.\n\n", MateMemoryLimit)
	tail, cut := mateMemoryTail(memory)
	switch {
	case strings.TrimSpace(memory) == "":
		b.WriteString("The file has no notes yet.\n")
	case cut:
		b.WriteString("The file is too large. This is only its last part. Make the file shorter: remove old or unused notes.\n\n")
		b.WriteString(tail)
	default:
		b.WriteString("The notes in the file now:\n\n")
		b.WriteString(memory)
	}
	return b.String()
}

func MateRepoWorkspace(m Mate, workspaces []Workspace, repo string) (Workspace, bool) {
	if repo == "" {
		return MateWorkspace(m, workspaces)
	}
	return MateWorkspace(Mate{Repos: []string{repo}}, workspaces)
}
