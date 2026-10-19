package domain

import (
	"fmt"
	"strings"
)

type MateTone struct {
	Terse    int `json:"terse,omitempty" toml:"terse"`
	Cautious int `json:"cautious,omitempty" toml:"cautious"`
	Formal   int `json:"formal,omitempty" toml:"formal"`
}

type MateToneAxis struct {
	Key   string    `json:"key"`
	Low   string    `json:"low"`
	High  string    `json:"high"`
	Steps [5]string `json:"steps"`
}

const MateToneSteps = 5

func MateToneAxes() []MateToneAxis {
	return []MateToneAxis{
		{Key: "terse", Low: "Terse", High: "Chatty", Steps: [5]string{
			"Keep answers very short. Use lists, not paragraphs, and give no background unless asked.",
			"Keep answers short. Use lists, not paragraphs.",
			"",
			"Explain your thinking in a few sentences.",
			"Explain your thinking in full, and talk through the options.",
		}},
		{Key: "cautious", Low: "Cautious", High: "Bold", Steps: [5]string{
			"Ask before you run any command that changes files, and before you push or open a PR.",
			"Ask before you run a command that changes files or pushes.",
			"",
			"Make small, safe changes without asking.",
			"Act on your own judgment. Ask only when you are blocked.",
		}},
		{Key: "formal", Low: "Formal", High: "Playful", Steps: [5]string{
			"Write in a formal, neutral tone.",
			"Write in a plain, professional tone.",
			"",
			"Use a light, friendly tone.",
			"Be playful. Light humor is welcome.",
		}},
	}
}

func (t MateTone) steps() []int {
	return []int{t.Terse, t.Cautious, t.Formal}
}

func checkMateTone(t MateTone) error {
	axes := MateToneAxes()
	for i, step := range t.steps() {
		if step < 0 || step > MateToneSteps {
			return fmt.Errorf("tone %s is %d; it must be 1 to %d", axes[i].Key, step, MateToneSteps)
		}
	}
	return nil
}

func MateToneSentences(t MateTone) []string {
	var out []string
	axes := MateToneAxes()
	for i, step := range t.steps() {
		if step < 1 || step > MateToneSteps {
			continue
		}
		if s := axes[i].Steps[step-1]; s != "" {
			out = append(out, s)
		}
	}
	return out
}

func mateToneTOML(t MateTone) string {
	var parts []string
	axes := MateToneAxes()
	for i, step := range t.steps() {
		if step != 0 {
			parts = append(parts, fmt.Sprintf("%s = %d", axes[i].Key, step))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "tone = { " + strings.Join(parts, ", ") + " }\n"
}
