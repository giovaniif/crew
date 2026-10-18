package tui

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

type matesPanel struct {
	cursor    int
	approvals []domain.Approval
	loading   bool
	stopping  bool
	err       string
	detail    *mateDetail
	create    *mateCreate
}

type mateDetail struct {
	name    string
	cursor  int
	memory  rpc.MateMemory
	loaded  bool
	editing bool
	edit    string
	err     string
}

type mateCreate struct {
	step   int
	field  int
	face   int
	name   string
	prompt string
	tone   [3]int
	agent  int
	model  string
	repos  string
	effort int
	err    string
}

type mateApprovalsMsg struct {
	list    []domain.Approval
	err     error
	mates   []domain.Mate
	matesOK bool
}

type mateListMsg struct {
	mates []domain.Mate
	err   error
}

type mateMemoryMsg struct {
	mem rpc.MateMemory
	err error
}

type mateCreatedMsg struct {
	mates []domain.Mate
	err   error
}

var mateAgents = []string{string(domain.HarnessClaude), string(domain.HarnessCodex)}

func (m *Model) loadMates(st rpc.State) {
	m.mateBoard = st.Mates
	m.mateLinks = map[string]domain.MateLink{}
	for _, l := range st.MateThreads {
		m.mateLinks[mateLinkKey(l)] = l
	}
}

func (m *Model) applyMates(d rpc.Diff) {
	if d.Mates != nil {
		m.mateBoard = *d.Mates
	}
	if d.MateThread != nil {
		if m.mateLinks == nil {
			m.mateLinks = map[string]domain.MateLink{}
		}
		m.mateLinks[mateLinkKey(*d.MateThread)] = *d.MateThread
	}
}

func mateLinkKey(l domain.MateLink) string {
	return domain.MateThreadKey(l.Team, l.Channel, l.ThreadTS, l.Mate)
}

func (m Model) mateDef(name string) domain.Mate {
	if d, ok := m.mateDefs[name]; ok {
		return d
	}
	return domain.Mate{Name: name}
}

func (m *Model) setMateDefs(list []domain.Mate) {
	m.mateDefs = map[string]domain.Mate{}
	for _, d := range list {
		m.mateDefs[d.Name] = d
	}
}

func (m Model) faceStyle(name string) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(domain.FaceColor(m.mateDef(name)))).Bold(true)
}

func (m Model) mateSessions(name string) []domain.Session {
	seen := map[string]bool{}
	var out []domain.Session
	for _, se := range m.sessions {
		if se.Mate != nil && se.Mate.Name == name {
			seen[se.ID] = true
			out = append(out, se)
		}
	}
	for _, l := range m.mateLinks {
		if se, ok := m.sessions[l.SessionID]; ok && l.Mate == name && !seen[se.ID] {
			seen[se.ID] = true
			out = append(out, se)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ended != out[j].Ended {
			return !out[i].Ended
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (m Model) mateFaceState(st domain.MateStatus) domain.FaceState {
	var states []domain.AgentState
	for _, se := range m.mateSessions(st.Name) {
		if !se.Ended {
			states = append(states, se.State)
		}
	}
	approvals := 0
	if m.mp != nil {
		for _, a := range m.mp.approvals {
			if a.Mate == st.Name {
				approvals++
			}
		}
	}
	return domain.MateFaceState(st, approvals, states)
}

func (m Model) faceWord(fs domain.FaceState) piece {
	s := m.styles
	switch fs {
	case domain.FaceWorking:
		return piece{s.green, "● working "}
	case domain.FaceNeeds:
		return piece{s.peach, "◆ needs you "}
	case domain.FacePaused:
		return piece{s.dim, "‖ paused "}
	}
	return piece{s.dim, "○ idle "}
}

func (m Model) fetchMateList() tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		var out rpc.MateList
		err := c.Call(ctx, rpc.MethodMateList, struct{}{}, &out)
		return mateListMsg{mates: out.Mates, err: err}
	}
}

func (m Model) openMates() (Model, tea.Cmd) {
	m.mp = &matesPanel{loading: true}
	approvals := m.fetchApprovals()
	list := m.fetchMateList()
	if approvals == nil {
		return m, nil
	}
	return m, func() tea.Msg {
		out := approvals().(mateApprovalsMsg)
		if l, ok := list().(mateListMsg); ok && l.err == nil {
			out.mates, out.matesOK = l.mates, true
		}
		return out
	}
}

func (m Model) fetchApprovals() tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		var list []domain.Approval
		err := c.Call(ctx, rpc.MethodApprovalList, struct{}{}, &list)
		return mateApprovalsMsg{list: list, err: err}
	}
}

func (m Model) approvalsLoaded(msg mateApprovalsMsg) Model {
	if msg.matesOK {
		m.setMateDefs(msg.mates)
	}
	if m.mp == nil {
		return m
	}
	p := *m.mp
	p.loading, p.approvals, p.err = false, msg.list, ""
	if msg.err != nil {
		p.err = msg.err.Error()
	}
	p.cursor = min(p.cursor, max(len(m.mateBoard.Mates)+len(p.approvals)-1, 0))
	m.mp = &p
	return m
}

func (m Model) decideApproval(id string, approve bool) tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	refresh := m.fetchApprovals()
	kept := m.mp.approvals
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		err := c.Call(ctx, rpc.MethodApprovalDecide, rpc.ApprovalDecideParams{ID: id, Approve: approve}, nil)
		out := refresh().(mateApprovalsMsg)
		if out.err != nil {
			out.list = kept
		}
		if err != nil {
			out.err = err
		}
		return out
	}
}

func (m Model) newConversation(name, handoffTo string) tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		if handoffTo != "" {
			if err := c.Call(ctx, rpc.MethodSessionSend, rpc.SessionSendParams{Session: handoffTo, Text: domain.MateHandoff}, nil); err != nil {
				return errMsg{err}
			}
		}
		var s domain.Session
		if err := c.Call(ctx, rpc.MethodMateNew, rpc.MateNewParams{Name: name}, &s); err != nil {
			return errMsg{err}
		}
		return sessionStartedMsg{session: s}
	}
}

func (m Model) fetchMemory(method string, params any) tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		var out rpc.MateMemory
		err := c.Call(ctx, method, params, &out)
		return mateMemoryMsg{mem: out, err: err}
	}
}

func (m Model) memoryLoaded(msg mateMemoryMsg) Model {
	if m.mp == nil || m.mp.detail == nil {
		return m
	}
	p := *m.mp
	d := *p.detail
	if msg.err != nil {
		d.err = msg.err.Error()
	} else {
		d.memory, d.loaded, d.editing, d.err = msg.mem, true, false, ""
	}
	p.detail = &d
	m.mp = &p
	return m
}

func (m Model) createMate(cr mateCreate) tea.Cmd {
	c := m.opts.Calls
	if c == nil {
		return nil
	}
	h := domain.Harness(mateAgents[cr.agent])
	efforts := append([]string{""}, domain.Spec(h).Efforts...)
	var repos []string
	for _, r := range strings.Split(cr.repos, ",") {
		if r = strings.TrimSpace(r); r != "" {
			repos = append(repos, r)
		}
	}
	mate := domain.Mate{
		Name: strings.TrimSpace(cr.name), Prompt: domain.WithTone(strings.TrimSpace(cr.prompt), cr.tone[:]),
		Agent: string(h), Model: strings.TrimSpace(cr.model), Effort: efforts[min(cr.effort, len(efforts)-1)],
		Repos: repos, Avatar: domain.MateFaces[cr.face].ID, Enabled: true,
	}
	list := m.fetchMateList()
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
		defer cancel()
		if err := c.Call(ctx, rpc.MethodMateSet, rpc.MateSetParams{Mate: mate}, &domain.Mate{}); err != nil {
			return mateCreatedMsg{err: err}
		}
		l := list().(mateListMsg)
		return mateCreatedMsg{mates: l.mates}
	}
}

func (m Model) mateCreated(msg mateCreatedMsg) Model {
	if m.mp == nil || m.mp.create == nil {
		return m
	}
	p := *m.mp
	if msg.err != nil {
		cr := *p.create
		cr.err = msg.err.Error()
		p.create = &cr
		m.mp = &p
		return m
	}
	m.setMateDefs(msg.mates)
	p.create = nil
	m.mp = &p
	return m
}

func typedRune(msg tea.KeyPressMsg) (string, bool) {
	if msg.Mod&^tea.ModShift != 0 || utf8.RuneCountInString(msg.Text) != 1 {
		return "", false
	}
	return msg.Text, true
}

func dropLast(s string) string {
	if s == "" {
		return s
	}
	_, n := utf8.DecodeLastRuneInString(s)
	return s[:len(s)-n]
}

func (m Model) matesPaste(text string) Model {
	if m.mp == nil {
		return m
	}
	p := *m.mp
	switch {
	case p.detail != nil && p.detail.editing:
		d := *p.detail
		d.edit += text
		p.detail = &d
	case p.create != nil:
		cr := *p.create
		cr.typeIn(text)
		p.create = &cr
	}
	m.mp = &p
	return m
}

func (cr *mateCreate) text() *string {
	switch {
	case cr.step == 0:
		return &cr.name
	case cr.step == 1 && cr.field == 0:
		return &cr.prompt
	case cr.step == 2 && cr.field == 1:
		return &cr.model
	case cr.step == 2 && cr.field == 2:
		return &cr.repos
	}
	return nil
}

func (cr *mateCreate) typeIn(s string) {
	if t := cr.text(); t != nil {
		*t += s
	}
}

func (cr *mateCreate) fields() int {
	return []int{1, 4, 4}[cr.step]
}

func (cr *mateCreate) move(d int) {
	switch {
	case cr.step == 0:
		cr.face = (cr.face + d + len(domain.MateFaces)) % len(domain.MateFaces)
	case cr.step == 1 && cr.field > 0:
		cr.tone[cr.field-1] = min(max(cr.tone[cr.field-1]+d, 0), 4)
	case cr.step == 2 && cr.field == 0:
		cr.agent = (cr.agent + d + len(mateAgents)) % len(mateAgents)
		cr.effort = 0
	case cr.step == 2 && cr.field == 3:
		n := len(domain.Spec(domain.Harness(mateAgents[cr.agent])).Efforts) + 1
		cr.effort = (cr.effort + d + n) % n
	}
}

func (m Model) createKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	p := *m.mp
	cr := *p.create
	p.create = &cr
	m.mp = &p
	switch k := msg.String(); k {
	case "esc":
		p.create = nil
	case "ctrl+n":
		cr.step, cr.field = min(cr.step+1, 2), 0
	case "ctrl+p":
		cr.step, cr.field = max(cr.step-1, 0), 0
	case "tab":
		cr.field = (cr.field + 1) % cr.fields()
	case "shift+tab":
		cr.field = (cr.field + cr.fields() - 1) % cr.fields()
	case "left":
		cr.move(-1)
	case "right":
		cr.move(1)
	case "backspace":
		if t := cr.text(); t != nil {
			*t = dropLast(*t)
		}
	case "enter":
		if cr.step < 2 {
			cr.step, cr.field = cr.step+1, 0
			break
		}
		cr.err = ""
		return m, m.createMate(cr)
	default:
		if r, ok := typedRune(msg); ok {
			cr.typeIn(r)
		}
	}
	return m, nil
}

func (m Model) detailKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	p := *m.mp
	d := *p.detail
	p.detail = &d
	m.mp = &p
	k := msg.String()
	if d.editing {
		switch k {
		case "esc":
			d.editing = false
		case "ctrl+s":
			return m, m.fetchMemory(rpc.MethodMateSetMemory, rpc.MateSetMemoryParams{Name: d.name, Text: d.edit})
		case "enter":
			d.edit += "\n"
		case "backspace":
			d.edit = dropLast(d.edit)
		default:
			if r, ok := typedRune(msg); ok {
				d.edit += r
			}
		}
		return m, nil
	}
	convs := m.mateSessions(d.name)
	switch k {
	case "esc", "q":
		p.detail = nil
	case "j", "down":
		d.cursor = min(d.cursor+1, max(len(convs)-1, 0))
	case "k", "up":
		d.cursor = max(d.cursor-1, 0)
	case "enter":
		if d.cursor < len(convs) {
			m.mp = nil
			return m, m.showNew(convs[d.cursor].ID)
		}
	case "c":
		m.mp = nil
		return m, m.newConversation(d.name, "")
	case "f":
		if d.cursor < len(convs) && !convs[d.cursor].Ended {
			m.mp = nil
			return m, m.newConversation(d.name, convs[d.cursor].ID)
		}
	case "m":
		d.editing, d.edit = true, d.memory.Text
	}
	return m, nil
}

func (m Model) matesKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.mp.create != nil {
		return m.createKey(msg)
	}
	if m.mp.detail != nil {
		return m.detailKey(msg)
	}
	p := *m.mp
	m.mp = &p
	k := msg.String()
	if p.stopping {
		p.stopping = false
		if k == "y" {
			return m, m.call(rpc.MethodMateStopAll, rpc.MateStopAllParams{Stop: true})
		}
		return m, nil
	}
	mates := m.mateBoard.Mates
	rows := len(mates) + len(p.approvals)
	switch k {
	case "esc", "q", "C":
		m.mp = nil
	case "j", "down":
		p.cursor = min(p.cursor+1, max(rows-1, 0))
	case "k", "up":
		p.cursor = max(p.cursor-1, 0)
	case "enter":
		if p.cursor < len(mates) {
			name := mates[p.cursor].Name
			p.detail = &mateDetail{name: name}
			return m, m.fetchMemory(rpc.MethodMateMemory, rpc.MateNameParams{Name: name})
		}
	case "c":
		if p.cursor < len(mates) {
			m.mp = nil
			return m, m.newConversation(mates[p.cursor].Name, "")
		}
	case "a":
		p.create = &mateCreate{tone: [3]int{domain.ToneMiddle, domain.ToneMiddle, domain.ToneMiddle}}
	case "p":
		if p.cursor < len(mates) {
			method := rpc.MethodMatePause
			if mates[p.cursor].State == domain.MatePaused {
				method = rpc.MethodMateResume
			}
			return m, m.call(method, rpc.MateNameParams{Name: mates[p.cursor].Name})
		}
	case "X":
		if m.mateBoard.Stopped {
			return m, m.call(rpc.MethodMateStopAll, rpc.MateStopAllParams{Stop: false})
		}
		p.stopping = true
	case "y", "n":
		if i := p.cursor - len(mates); i >= 0 && i < len(p.approvals) {
			return m, m.decideApproval(p.approvals[i].ID, k == "y")
		}
	case "g":
		return m, m.fetchApprovals()
	}
	return m, nil
}

func mateStateWords(s domain.MateStatus) string {
	words := strings.ReplaceAll(string(s.State), "_", " ")
	if s.Guard != domain.GuardNone {
		words += " · " + strings.ReplaceAll(string(s.Guard), "_", " ")
	}
	return words
}

func (m Model) mateThreadsOf(name string) []domain.MateLink {
	var out []domain.MateLink
	for _, l := range m.mateLinks {
		if l.Mate == name {
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ThreadTS > out[j].ThreadTS })
	return out
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	return cleanText(s)
}

func glyphCell(g string) string {
	return g + strings.Repeat(" ", max(7-utf8.RuneCountInString(g), 0))
}

func (m Model) hints(rows ...[]string) []string {
	s := m.styles
	var out []string
	for _, row := range rows {
		var ps []piece
		for i := 0; i+1 < len(row); i += 2 {
			ps = append(ps, piece{s.bold, " " + row[i]}, piece{s.dim, " " + row[i+1] + " "})
		}
		out = append(out, m.line(false, ps, nil))
	}
	return out
}

func (m Model) mateFacts(mt domain.Mate) string {
	return strings.Join(nonEmpty(mt.Agent, mt.Model, mt.Effort), " · ")
}

func nonEmpty(xs ...string) []string {
	var out []string
	for _, x := range xs {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

func (m Model) matePanelLines() ([]string, int) {
	if m.mp.create != nil {
		return m.createLines(), 0
	}
	if m.mp.detail != nil {
		return m.detailLines()
	}
	s := m.styles
	p := m.mp
	out := []string{"", m.line(false, []piece{{s.header, " MATES"}}, nil), ""}
	if m.mateBoard.Stopped {
		out = append(out, m.line(false, []piece{{s.peach, " ■ all mates are stopped · X starts them"}}, nil), "")
	}
	sel := 0
	if len(m.mateBoard.Mates) == 0 {
		out = append(out, m.line(false, []piece{{s.sub, " No mates yet: a makes one"}}, nil))
	}
	for i, mt := range m.mateBoard.Mates {
		on := i == p.cursor
		bar := piece{s.text, " "}
		if on {
			bar, sel = piece{s.bar, "▌"}, len(out)
		}
		def := m.mateDef(mt.Name)
		fs := m.mateFaceState(mt)
		g := domain.FaceGlyph(domain.FaceOf(def), fs)
		fst := m.faceStyle(mt.Name)
		out = append(out,
			m.line(on, []piece{bar, {fst, " " + glyphCell(g[0])}, {s.bold, " " + mt.Name}}, []piece{m.faceWord(fs)}),
			m.line(on, []piece{bar, {fst, " " + glyphCell(g[1])}, {s.sub, " " + firstLine(def.Prompt)}}, nil))
		if !on {
			continue
		}
		out = append(out, m.line(on, []piece{bar, {s.dim, "         " + m.mateFacts(def)}}, []piece{{s.dim, mateStateWords(mt) + " "}}))
		if mt.Error != "" {
			out = append(out, m.line(on, []piece{bar, {s.peach, "         " + cleanText(mt.Error)}}, nil))
		}
		threads := m.mateThreadsOf(mt.Name)
		for _, l := range threads[:min(len(threads), 5)] {
			name := l.SessionID
			state := "ended"
			if se, ok := m.sessions[l.SessionID]; ok {
				name = domain.NameFor(m.tasks[se.TaskID], nil)
				if !se.Ended {
					state = string(se.State)
				}
			}
			out = append(out, m.line(on, []piece{bar, {s.sub, "         " + cleanText(name)}}, []piece{{s.dim, state + " "}}))
		}
	}
	out = append(out, "", m.rule("NEEDS YOU", nil))
	switch {
	case p.loading:
		out = append(out, m.line(false, []piece{{s.dim, " loading…"}}, nil))
	case p.err != "":
		out = append(out, m.line(false, []piece{{s.peach, " " + cleanText(p.err)}}, nil))
	case len(p.approvals) == 0:
		out = append(out, m.line(false, []piece{{s.sub, " No approvals wait for you."}}, nil))
	}
	for i, a := range p.approvals {
		on := len(m.mateBoard.Mates)+i == p.cursor
		bar := piece{s.text, " "}
		if on {
			bar, sel = piece{s.bar, "▌"}, len(out)
		}
		who := a.Requester
		if who == "" {
			who = "someone"
		}
		g := domain.FaceGlyph(domain.FaceOf(m.mateDef(a.Mate)), domain.FaceNeeds)
		out = append(out, m.line(on, []piece{bar, {m.faceStyle(a.Mate), " " + glyphCell(g[0])}, {s.bold, " " + a.Mate + ": "}, {s.peach, strings.ReplaceAll(string(a.Action.Kind), "_", " ")}}, []piece{{s.dim, who + " "}}))
		if on {
			out = append(out, m.line(on, []piece{bar, {s.dim, "         " + cleanText(a.Action.Tool+": "+a.Action.Input)}}, []piece{{s.bold, "y"}, {s.dim, "/"}, {s.bold, "n "}}))
		}
	}
	if p.stopping {
		return append(out, "", m.line(false, []piece{{s.peach, " stop all mates? y/n"}}, nil)), sel
	}
	if m.status != "" {
		out = append(out, "", m.line(false, []piece{{s.peach, " " + cleanText(m.status)}}, nil))
	}
	out = append(out, "")
	return append(out, m.hints(
		[]string{"enter", "open", "c", "new conversation", "a", "new mate"},
		[]string{"p", "pause", "y/n", "approve", "X", "stop all", "esc", "close"})...), sel
}

func (m Model) detailLines() ([]string, int) {
	s := m.styles
	d := m.mp.detail
	def := m.mateDef(d.name)
	st := domain.MateStatus{Name: d.name}
	for _, b := range m.mateBoard.Mates {
		if b.Name == d.name {
			st = b
		}
	}
	fs := m.mateFaceState(st)
	g := domain.FaceGlyph(domain.FaceOf(def), fs)
	fst := m.faceStyle(d.name)
	slack := "off"
	if st.State != domain.MateReady && st.State != domain.MateNoTokens && st.State != "" {
		slack = mateStateWords(st)
	}
	out := []string{"",
		m.line(false, []piece{{fst, "   " + glyphCell(g[0])}, {s.bold, " " + d.name}}, []piece{m.faceWord(fs)}),
		m.line(false, []piece{{fst, "   " + glyphCell(g[1])}, {s.sub, " " + firstLine(def.Prompt)}}, nil),
		"",
		m.line(false, []piece{{s.dim, "   agent  "}, {s.text, m.mateFacts(def)}}, nil),
		m.line(false, []piece{{s.dim, "   repos  "}, {s.text, strings.Join(def.Repos, ", ")}}, nil),
		m.line(false, []piece{{s.dim, "   slack  "}, {s.text, slack}}, nil),
		"", m.rule("CONVERSATIONS", nil)}
	sel := 0
	convs := m.mateSessions(d.name)
	if len(convs) == 0 {
		out = append(out, m.line(false, []piece{{s.sub, " No conversations yet. c starts one."}}, nil))
	}
	for i, se := range convs {
		on := i == d.cursor
		bar := piece{s.text, " "}
		if on {
			bar, sel = piece{s.bar, "▌"}, len(out)
		}
		dot, state := piece{s.green, " ● "}, string(se.State)
		if se.Ended {
			dot, state = piece{s.dim, " ○ "}, "ended"
		}
		name := domain.NameFor(m.tasks[se.TaskID], nil)
		if name == "" {
			name = se.ID
		}
		out = append(out, m.line(on, []piece{bar, dot, {s.bold, cleanText(name)}}, []piece{{s.dim, state + " "}}))
	}
	limit := d.memory.Limit
	if limit == 0 {
		limit = domain.MateMemoryLimit
	}
	text := d.memory.Text
	if d.editing {
		text = d.edit
	}
	out = append(out, "", m.rule("MEMORY", []piece{{s.dim, strconv.Itoa(len(text)) + "/" + strconv.Itoa(limit) + " "}}))
	switch {
	case d.err != "":
		out = append(out, m.line(false, []piece{{s.peach, " " + cleanText(d.err)}}, nil))
	case !d.loaded:
		out = append(out, m.line(false, []piece{{s.dim, " loading…"}}, nil))
	case strings.TrimSpace(text) == "" && !d.editing:
		out = append(out, m.line(false, []piece{{s.sub, " Empty. The mate writes notes here."}}, nil))
	}
	if d.loaded || d.editing {
		lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
		if d.editing {
			lines = strings.Split(text, "\n")
			lines[len(lines)-1] += "▏"
		}
		if strings.TrimSpace(text) != "" || d.editing {
			for _, l := range lines[max(len(lines)-12, 0):] {
				out = append(out, m.line(false, []piece{{s.sub, " " + cleanText(l)}}, nil))
			}
		}
	}
	out = append(out, "")
	if d.editing {
		return append(out, m.hints([]string{"ctrl+s", "save", "enter", "new line", "esc", "cancel"})...), sel
	}
	return append(out, m.hints(
		[]string{"enter", "open", "c", "new conversation", "f", "start fresh"},
		[]string{"m", "edit memory", "esc", "back"})...), sel
}

func (m Model) createLines() []string {
	s := m.styles
	cr := m.mp.create
	stepPiece := func(i int, label string) piece {
		if i == cr.step {
			return piece{s.mauve.Bold(true), label}
		}
		return piece{s.dim, label}
	}
	out := []string{"", m.line(false, []piece{{s.header, " NEW MATE"}}, nil),
		m.line(false, []piece{{s.text, " "}, stepPiece(0, "1 face"), {s.dim, " ── "}, stepPiece(1, "2 personality"), {s.dim, " ── "}, stepPiece(2, "3 brains")}, nil), ""}
	focus := func(i int) piece {
		if cr.field == i {
			return piece{s.mauve.Bold(true), " › "}
		}
		return piece{s.dim, "   "}
	}
	cursor := func(i int) string {
		if cr.field == i {
			return "▏"
		}
		return ""
	}
	switch cr.step {
	case 0:
		f := domain.MateFaces[cr.face]
		fst := lipgloss.NewStyle().Foreground(lipgloss.Color(f.Light)).Bold(true)
		out = append(out,
			m.line(false, []piece{{s.dim, "   face   ‹ "}, {fst, f.Glyph[0]}, {s.dim, " ›  "}, {s.bold, f.Name}}, nil),
			m.line(false, []piece{{s.dim, "            "}, {fst, f.Glyph[1]}}, nil),
			"",
			m.line(false, []piece{{s.dim, "   name   "}, {s.text, cleanText(cr.name) + "▏"}}, nil))
	case 1:
		out = append(out, m.line(false, []piece{focus(0), {s.dim, "prompt  "}, {s.text, cleanText(cr.prompt) + cursor(0)}}, nil), "",
			m.line(false, []piece{{s.dim, "   tone"}}, nil))
		for i, ax := range domain.ToneAxes {
			dots := make([]string, 5)
			for j := range dots {
				dots[j] = "·"
				if j == cr.tone[i] {
					dots[j] = "●"
				}
			}
			out = append(out, m.line(false, []piece{focus(i + 1), {s.sub, glyphPad(ax.Low, 9)}, {s.mauve, strings.Join(dots, "─")}, {s.sub, "  " + ax.High + " "}, {s.dim, strconv.Itoa(cr.tone[i]+1) + "/5"}}, nil))
		}
		out = append(out, "", m.line(false, []piece{{s.header, " Added to the prompt"}}, nil))
		for i, ax := range domain.ToneAxes {
			sentence := ax.Steps[cr.tone[i]]
			out = append(out, m.line(false, []piece{{s.dim, "  " + ax.Low + " " + strconv.Itoa(cr.tone[i]+1) + "/5"}}, nil))
			if sentence == "" {
				out = append(out, m.line(false, []piece{{s.dim, " Middle step. Adds no text."}}, nil))
				continue
			}
			out = append(out, m.line(false, []piece{{s.text, " " + sentence}}, nil))
		}
	case 2:
		h := domain.Harness(mateAgents[cr.agent])
		efforts := append([]string{"default"}, domain.Spec(h).Efforts...)
		out = append(out,
			m.line(false, []piece{focus(0), {s.dim, "agent   ‹ "}, {s.text, mateAgents[cr.agent]}, {s.dim, " ›"}}, nil),
			m.line(false, []piece{focus(1), {s.dim, "model   "}, {s.text, cleanText(cr.model) + cursor(1)}}, nil),
			m.line(false, []piece{focus(2), {s.dim, "repos   "}, {s.text, cleanText(cr.repos) + cursor(2)}}, nil),
			m.line(false, []piece{focus(3), {s.dim, "effort  ‹ "}, {s.text, efforts[min(cr.effort, len(efforts)-1)]}, {s.dim, " ›"}}, nil),
			"",
			m.line(false, []piece{{s.dim, " Slack is optional: crew mate slack <name>"}}, nil))
	}
	if cr.err != "" {
		out = append(out, "", m.line(false, []piece{{s.peach, " " + cleanText(cr.err)}}, nil))
	}
	out = append(out, "")
	last := []string{"ctrl+p", "back", "enter", "next", "esc", "cancel"}
	if cr.step == 2 {
		last[3] = "create"
	}
	return append(out, m.hints([]string{"←/→", "pick", "tab", "field", "ctrl+n", "next step"}, last)...)
}

func glyphPad(s string, n int) string {
	return s + strings.Repeat(" ", max(n-utf8.RuneCountInString(s), 0))
}

func (m Model) sidebarMateLines() []string {
	if len(m.mateBoard.Mates) == 0 {
		return nil
	}
	s := m.styles
	out := []string{"", m.rule("MATES", nil)}
	for _, mt := range m.mateBoard.Mates {
		live := 0
		for _, se := range m.mateSessions(mt.Name) {
			if !se.Ended {
				live++
			}
		}
		g := domain.FaceGlyph(domain.FaceOf(m.mateDef(mt.Name)), domain.FaceIdle)
		right := piece{s.dim, "idle "}
		switch fs := m.mateFaceState(mt); {
		case fs == domain.FacePaused:
			right = piece{s.dim, "paused "}
		case live > 0 && fs == domain.FaceNeeds:
			right = piece{s.peach, strconv.Itoa(live) + " live "}
		case live > 0:
			right = piece{s.green, strconv.Itoa(live) + " live "}
		}
		out = append(out, m.line(false, []piece{{m.faceStyle(mt.Name), "  " + glyphCell(g[0])}, {s.text, " " + mt.Name}}, []piece{right}))
	}
	return out
}
