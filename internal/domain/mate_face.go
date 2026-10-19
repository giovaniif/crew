package domain

type FaceState string

const (
	FaceIdle     FaceState = "idle"
	FaceWorking  FaceState = "working"
	FaceThinking FaceState = "thinking"
	FaceNeeds    FaceState = "needs"
	FacePaused   FaceState = "paused"
)

type MateFace struct {
	ID    string
	Name  string
	Light string
	Dark  string
	Glyph [2]string
}

var MateFaces = []MateFace{
	{"pip", "Pip", "#7287fd", "#b4befe", [2]string{"[● ●]", "[ ‿ ]"}},
	{"bolt", "Bolt", "#209fb5", "#74c7ec", [2]string{"[■ ■]", "[ ─ ]"}},
	{"sage", "Sage", "#40a02b", "#a6e3a1", [2]string{"(^ ^)", "( · )"}},
	{"visor", "Visor", "#179299", "#94e2d5", [2]string{"[▬▬▬]", "[ ‿ ]"}},
	{"iris", "Iris", "#8839ef", "#cba6f7", [2]string{"( ◉ )", "( ─ )"}},
	{"owl", "Owl", "#fe640b", "#fab387", [2]string{"[◎ ◎]", "[ ▾ ]"}},
	{"dash", "Dash", "#04a5e5", "#89dceb", [2]string{"[▮ ▮]", `[\_/]`}},
	{"wink", "Wink", "#ea76cb", "#f5c2e7", [2]string{"(● ─)", "(  ‿)"}},
	{"prism", "Prism", "#df8e1d", "#f9e2af", [2]string{"<◆ ◆>", "< ─ >"}},
	{"moss", "Moss", "#dc8a78", "#f5e0dc", [2]string{"[◡ ◡]", "[ ‿ ]"}},
	{"beacon", "Beacon", "#d20f39", "#f38ba8", [2]string{"╷● ●╷", "╵ o ╵"}},
	{"quill", "Quill", "#dd7878", "#f2cdcd", [2]string{"(▯ ▯)", "( ‿ )"}},
}

func faceByID(id string) (MateFace, bool) {
	for _, f := range MateFaces {
		if f.ID == id {
			return f, true
		}
	}
	return MateFace{}, false
}

func FaceOf(m Mate) MateFace {
	if f, ok := faceByID(m.Avatar); ok {
		return f
	}
	if f, ok := faceByID(m.Name); ok {
		return f
	}
	sum := 0
	for _, b := range []byte(m.Name) {
		sum += int(b)
	}
	return MateFaces[sum%len(MateFaces)]
}

func FaceColor(m Mate) string {
	if m.Color != "" {
		return m.Color
	}
	return FaceOf(m).Light
}

func FaceGlyph(f MateFace, st FaceState) [2]string {
	top, bot := []rune(f.Glyph[0]), []rune(f.Glyph[1])
	edge := func(r []rune, mid string) string { return string(r[0]) + mid + string(r[4]) }
	switch st {
	case FacePaused:
		return [2]string{edge(top, "─ ─"), edge(bot, " ─ ")}
	case FaceThinking:
		return [2]string{edge(top, "˙ ˙"), edge(bot, " ─ ") + " …"}
	case FaceWorking:
		return [2]string{f.Glyph[0], f.Glyph[1] + " ⠋"}
	case FaceNeeds:
		return [2]string{f.Glyph[0] + " !", edge(bot, " o ")}
	}
	return f.Glyph
}

func MateFaceState(st MateStatus, approvals int, sessions []AgentState) FaceState {
	if st.State == MatePaused || st.Guard != GuardNone {
		return FacePaused
	}
	working := false
	for _, s := range sessions {
		if s == StateWaiting || s == StatePermission {
			return FaceNeeds
		}
		working = working || s == StateRunning
	}
	switch {
	case approvals > 0:
		return FaceNeeds
	case working:
		return FaceWorking
	}
	return FaceIdle
}

