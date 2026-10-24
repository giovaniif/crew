package domain

import (
	"fmt"
	"strings"
)

const (
	IdentityYours      = "yours"
	IdentityYoursLabel = "Your accounts"
	identityKindYours  = "yours"
	identityKindOther  = "separate"
	identityHeader     = "[[identity]]"
)

func IdentityKindOf(kind EnvKind) string {
	if kind == EnvLocal {
		return identityKindYours
	}
	return identityKindOther
}

func EnvKindOfIdentity(kind string) EnvKind {
	if kind == identityKindYours {
		return EnvLocal
	}
	return EnvCustom
}

func IdentityTOML(env Environment) string {
	label := env.Label
	if label == "" {
		label = env.Name
	}
	var b strings.Builder
	b.WriteString(identityHeader + "\n")
	fmt.Fprintf(&b, "id = %s\n", tomlString(env.Name))
	fmt.Fprintf(&b, "name = %s\n", tomlString(label))
	fmt.Fprintf(&b, "kind = %s\n", tomlString(IdentityKindOf(env.Kind)))
	if len(env.Parts) > 0 {
		parts := make([]string, len(env.Parts))
		for i, p := range env.Parts {
			parts[i] = string(p)
		}
		fmt.Fprintf(&b, "parts = %s\n", tomlStrings(parts))
	}
	if len(env.Extra) > 0 {
		fmt.Fprintf(&b, "extra = %s\n", tomlStrings(env.Extra))
	}
	return b.String()
}

func findIdentity(lines []string, id string) (mateSpan, bool) {
	for start := 0; start < len(lines); start++ {
		if strings.TrimSpace(lines[start]) != identityHeader {
			continue
		}
		end := start + 1
		for end < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[end]), "[") {
			end++
		}
		for end > start+1 && strings.TrimSpace(lines[end-1]) == "" {
			end--
		}
		if blockKey(lines[start+1:end], "id") == id {
			return mateSpan{start, end}, true
		}
	}
	return mateSpan{}, false
}

func blockKey(lines []string, want string) string {
	for _, l := range lines {
		key, value, found := strings.Cut(strings.TrimSpace(l), "=")
		if found && strings.TrimSpace(key) == want {
			return strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return ""
}

func SetIdentityBlock(src string, env Environment) string {
	block := IdentityTOML(env)
	lines := splitConfigLines(src)
	if span, ok := findIdentity(lines, env.Name); ok {
		return strings.Join(lines[:span.start], "") + block + strings.Join(lines[span.end:], "")
	}
	if src == "" {
		return block
	}
	if !strings.HasSuffix(src, "\n") {
		src += "\n"
	}
	return src + "\n" + block
}

func RemoveIdentityBlock(src, id string) string {
	lines := splitConfigLines(src)
	span, ok := findIdentity(lines, id)
	if !ok {
		return src
	}
	rest := span.end
	for rest < len(lines) && strings.TrimSpace(lines[rest]) == "" {
		rest++
	}
	head := lines[:span.start]
	if rest == len(lines) {
		for len(head) > 0 && strings.TrimSpace(head[len(head)-1]) == "" {
			head = head[:len(head)-1]
		}
	}
	return strings.Join(head, "") + strings.Join(lines[rest:], "")
}

type IdentityMove struct {
	From string
	To   string
}

type IdentityPlan struct {
	Text    string
	Moves   []IdentityMove
	Changed bool
}

func PlanIdentityMigration(src string, envs []Environment, mates []Mate, machine string) IdentityPlan {
	plan := IdentityPlan{Text: src}
	ids := map[string]string{"": IdentityYours, string(EnvLocal): IdentityYours}
	yours := false
	for _, e := range envs {
		id := Environment{Name: e.Name, Kind: EnvCustom, Parts: e.Parts, Extra: e.Extra}
		if e.Kind == EnvLocal {
			id.Parts = nil
			if !yours {
				yours = true
				id = Environment{Name: IdentityYours, Label: IdentityYoursLabel, Kind: EnvLocal, Extra: e.Extra}
			}
		}
		ids[e.Name] = id.Name
		plan.Text = SetIdentityBlock(RemoveEnvBlock(plan.Text, e.Name), id)
		plan.Moves = append(plan.Moves, IdentityMove{From: e.Name, To: id.Name})
		plan.Changed = true
	}
	for _, m := range mates {
		if m.Machine != "" {
			continue
		}
		id, ok := ids[m.Env]
		if !ok {
			id = m.Env
		}
		m.Env, m.Machine = id, machine
		plan.Text = SetMateBlock(plan.Text, m)
		plan.Changed = true
	}
	return plan
}
