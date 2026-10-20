package serve

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/giovaniif/crew/internal/rpc"
)

const (
	CloseNoPane         websocket.StatusCode = 4404
	defaultTerminalCols                      = 80
	defaultTerminalRows                      = 24
	maxKeyChunk                              = 256
	paneQueryFormat                          = "#{window_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{cursor_flag}"
	badTerminalFrame                         = `send keys as binary frames, or {"size": {"cols": <n>, "rows": <n>}} with both at least 1`
)

type TerminalFrame struct {
	Screen *TerminalScreen `json:"screen,omitempty"`
	Error  *rpc.Error      `json:"error,omitempty"`
}

type TerminalScreen struct {
	Pane   string         `json:"pane"`
	Window string         `json:"window"`
	Cols   int            `json:"cols"`
	Rows   int            `json:"rows"`
	Cursor TerminalCursor `json:"cursor"`
	Data   string         `json:"data"`
}

type TerminalCursor struct {
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Visible bool `json:"visible"`
}

type terminalSize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

type terminalHello struct {
	Token string `json:"token"`
	Cols  int    `json:"cols"`
	Rows  int    `json:"rows"`
}

type terminalClientFrame struct {
	Size *terminalSize `json:"size"`
}

type controlCall int

const (
	callIgnore controlCall = iota
	callQuery
	callCapture
)

type controlEventKind int

const (
	eventOutput controlEventKind = iota
	eventBegin
	eventReply
	eventExit
)

type controlEvent struct {
	kind   controlEventKind
	pane   string
	bytes  []byte
	number int
	mine   bool
	ok     bool
	lines  []string
	reason string
}

type terminal struct {
	conn    *websocket.Conn
	pane    string
	writeMu sync.Mutex
	ctlMu   sync.Mutex
	ctl     io.Writer
	queue   []controlCall
	window  string
}

func (s *Server) terminal(w http.ResponseWriter, r *http.Request) {
	if err := s.checkOrigin(r); err != nil {
		writeError(w, err)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(streamReadLimit)
	ctx, cancel := context.WithCancelCause(s.base)
	defer cancel(nil)
	readCtx, stopReading := context.WithCancel(context.Background())
	defer stopReading()
	code, reason := s.runTerminal(ctx, cancel, readCtx, conn, r.PathValue("pane"))
	_ = conn.Close(code, reason)
	if code != websocket.StatusNormalClosure && code != websocket.StatusGoingAway {
		s.log.printf("terminal closed %d from %s: %s", code, clientAddr(r), reason)
	}
}

func (s *Server) runTerminal(ctx context.Context, cancel context.CancelCauseFunc, readCtx context.Context, conn *websocket.Conn, pane string) (websocket.StatusCode, string) {
	data, code, reason := s.readFirst(ctx, readCtx, conn)
	if data == nil {
		return code, reason
	}
	var hello terminalHello
	if json.Unmarshal(data, &hello) != nil || hello.Token == "" {
		return CloseBadHandshake, `the first frame must be {"token": "<device token>", "cols": <n>, "rows": <n>}`
	}
	d, err := s.dial(ctx)
	if err != nil {
		return websocket.StatusTryAgainLater, apiError(err).Message
	}
	defer func() { _ = d.Close() }()
	device, err := s.check(ctx, d, hello.Token)
	if err != nil {
		e := apiError(err)
		if e.Code == rpc.CodeUnauthorized {
			return CloseUnauthorized, e.Message
		}
		return websocket.StatusTryAgainLater, e.Message
	}
	unregister, ok := s.streams.add(device.ID, cancel)
	if !ok {
		return CloseUnauthorized, errRevoked.Error()
	}
	defer unregister()
	size := terminalSize{Cols: hello.Cols, Rows: hello.Rows}
	if size.Cols < 1 || size.Rows < 1 {
		size = terminalSize{Cols: defaultTerminalCols, Rows: defaultTerminalRows}
	}
	var native rpc.NativeClient
	if err := d.Call(ctx, rpc.MethodClientNative, rpc.NativeClientParams{Cols: size.Cols, Rows: size.Rows}, &native); err != nil {
		return websocket.StatusTryAgainLater, apiError(err).Message
	}
	window, found := nativeWindow(native, pane)
	if !found {
		return CloseNoPane, "no pane " + pane + " on the crew tmux server"
	}
	if s.cfg.Control == nil {
		return websocket.StatusTryAgainLater, "this crew serve cannot run tmux"
	}
	ctl, err := s.cfg.Control(ctx, native.Argv)
	if err != nil {
		return websocket.StatusTryAgainLater, "start tmux: " + err.Error()
	}
	defer func() { _ = ctl.Close() }()
	t := &terminal{conn: conn, pane: pane, ctl: ctl, window: window}
	events := readControl(ctl)
	if err := t.start(size); err != nil {
		return websocket.StatusTryAgainLater, "tmux: " + err.Error()
	}
	go func() {
		cancel(t.readLoop(readCtx, ctx))
	}()
	return t.run(ctx, events, size)
}

func (s *Server) readFirst(ctx, readCtx context.Context, conn *websocket.Conn) ([]byte, websocket.StatusCode, string) {
	stopping := context.AfterFunc(ctx, func() {
		_ = conn.Close(closeFor(context.Cause(ctx)))
	})
	lateReason := "no token within " + s.cfg.AuthTimeout.String()
	late := time.AfterFunc(s.cfg.AuthTimeout, func() {
		_ = conn.Close(CloseBadHandshake, lateReason)
	})
	_, data, err := conn.Read(readCtx)
	serving := stopping()
	if !late.Stop() {
		return nil, CloseBadHandshake, lateReason
	}
	if !serving {
		code, reason := closeFor(context.Cause(ctx))
		return nil, code, reason
	}
	if err != nil {
		return nil, websocket.StatusNormalClosure, errClientGone.Error()
	}
	if data == nil {
		data = []byte{}
	}
	return data, 0, ""
}

func nativeWindow(native rpc.NativeClient, pane string) (string, bool) {
	for _, p := range native.Panes {
		if p.Pane == pane {
			return p.Window, true
		}
	}
	return "", false
}

func (t *terminal) start(size terminalSize) error {
	if err := t.send(callIgnore, t.sizeCommand(size)); err != nil {
		return err
	}
	if err := t.send(callQuery, "display-message -p -t "+t.pane+" '"+paneQueryFormat+"'"); err != nil {
		return err
	}
	return t.send(callCapture, "capture-pane -p -e -t "+t.pane)
}

func (t *terminal) sizeCommand(size terminalSize) string {
	return fmt.Sprintf("refresh-client -C %s:%dx%d", t.currentWindow(), size.Cols, size.Rows)
}

func (t *terminal) currentWindow() string {
	t.ctlMu.Lock()
	defer t.ctlMu.Unlock()
	return t.window
}

func (t *terminal) send(call controlCall, command string) error {
	t.ctlMu.Lock()
	defer t.ctlMu.Unlock()
	t.queue = append(t.queue, call)
	_, err := io.WriteString(t.ctl, command+"\n")
	return err
}

func (t *terminal) next() controlCall {
	t.ctlMu.Lock()
	defer t.ctlMu.Unlock()
	if len(t.queue) == 0 {
		return callIgnore
	}
	call := t.queue[0]
	t.queue = t.queue[1:]
	return call
}

func (t *terminal) run(ctx context.Context, events <-chan controlEvent, size terminalSize) (websocket.StatusCode, string) {
	bound := map[int]controlCall{}
	ready := false
	var screen TerminalScreen
	for {
		select {
		case <-ctx.Done():
			return closeFor(context.Cause(ctx))
		case ev, ok := <-events:
			if !ok {
				return websocket.StatusTryAgainLater, "tmux control mode ended"
			}
			switch ev.kind {
			case eventExit:
				return websocket.StatusTryAgainLater, "tmux control mode ended: " + ev.reason
			case eventOutput:
				if ready && ev.pane == t.pane && len(ev.bytes) > 0 {
					if err := t.writeBinary(ctx, ev.bytes); err != nil {
						return writeFailed(ctx)
					}
				}
			case eventBegin:
				if ev.mine {
					bound[ev.number] = t.next()
				}
			case eventReply:
				call := bound[ev.number]
				delete(bound, ev.number)
				switch call {
				case callQuery:
					if !ev.ok {
						return CloseNoPane, "pane " + t.pane + " is gone"
					}
					screen = t.parseQuery(ev.lines, size)
				case callCapture:
					if !ev.ok {
						return CloseNoPane, "pane " + t.pane + " is gone"
					}
					screen.Data = screenData(ev.lines, screen)
					shown := screen
					if err := t.writeJSON(ctx, TerminalFrame{Screen: &shown}); err != nil {
						return writeFailed(ctx)
					}
					ready = true
				}
			}
		}
	}
}

func (t *terminal) parseQuery(lines []string, size terminalSize) TerminalScreen {
	screen := TerminalScreen{Pane: t.pane, Window: t.currentWindow(), Cols: size.Cols, Rows: size.Rows}
	if len(lines) == 0 {
		return screen
	}
	f := strings.Fields(lines[0])
	if len(f) != 6 {
		return screen
	}
	screen.Window = f[0]
	t.ctlMu.Lock()
	t.window = f[0]
	t.ctlMu.Unlock()
	screen.Cols, _ = strconv.Atoi(f[1])
	screen.Rows, _ = strconv.Atoi(f[2])
	screen.Cursor.X, _ = strconv.Atoi(f[3])
	screen.Cursor.Y, _ = strconv.Atoi(f[4])
	screen.Cursor.Visible = f[5] == "1"
	return screen
}

func screenData(lines []string, screen TerminalScreen) string {
	if screen.Rows > 0 && len(lines) > screen.Rows {
		lines = lines[:screen.Rows]
	}
	var b strings.Builder
	b.WriteString("\x1b[0m\x1b[H\x1b[2J")
	b.WriteString(strings.Join(lines, "\r\n"))
	fmt.Fprintf(&b, "\x1b[%d;%dH", screen.Cursor.Y+1, screen.Cursor.X+1)
	if screen.Cursor.Visible {
		b.WriteString("\x1b[?25h")
	} else {
		b.WriteString("\x1b[?25l")
	}
	return b.String()
}

func (t *terminal) readLoop(readCtx, ctx context.Context) error {
	for {
		typ, data, err := t.conn.Read(readCtx)
		if err != nil {
			return errClientGone
		}
		if err := t.handle(ctx, typ, data); err != nil {
			return err
		}
	}
}

func (t *terminal) handle(ctx context.Context, typ websocket.MessageType, data []byte) error {
	if typ == websocket.MessageBinary {
		for _, command := range sendKeys(t.pane, data) {
			if err := t.send(callIgnore, command); err != nil {
				return err
			}
		}
		return nil
	}
	var f terminalClientFrame
	if json.Unmarshal(data, &f) != nil || f.Size == nil || f.Size.Cols < 1 || f.Size.Rows < 1 {
		return t.writeJSON(ctx, TerminalFrame{Error: &rpc.Error{Code: rpc.CodeBadRequest, Message: badTerminalFrame}})
	}
	return t.send(callIgnore, t.sizeCommand(*f.Size))
}

func sendKeys(pane string, data []byte) []string {
	var out []string
	for start := 0; start < len(data); start += maxKeyChunk {
		end := min(start+maxKeyChunk, len(data))
		var b strings.Builder
		b.WriteString("send-keys -H -t " + pane)
		for _, c := range data[start:end] {
			fmt.Fprintf(&b, " %02x", c)
		}
		out = append(out, b.String())
	}
	return out
}

func (t *terminal) writeJSON(ctx context.Context, f TerminalFrame) error {
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	return t.write(ctx, websocket.MessageText, data)
}

func (t *terminal) writeBinary(ctx context.Context, data []byte) error {
	return t.write(ctx, websocket.MessageBinary, data)
}

func (t *terminal) write(ctx context.Context, typ websocket.MessageType, data []byte) error {
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, streamWriteTimeout)
	defer cancel()
	return t.conn.Write(wctx, typ, data)
}

func readControl(r io.Reader) <-chan controlEvent {
	out := make(chan controlEvent, 64)
	go func() {
		defer close(out)
		br := bufio.NewReader(r)
		var p controlParser
		for {
			line, err := br.ReadBytes('\n')
			if len(line) > 0 {
				line = bytes.TrimSuffix(bytes.TrimSuffix(line, []byte("\n")), []byte("\r"))
				if ev, ok := p.feed(line); ok {
					out <- ev
					if ev.kind == eventExit {
						return
					}
				}
			}
			if err != nil {
				return
			}
		}
	}()
	return out
}

type controlParser struct {
	inBlock bool
	block   int
	body    []string
}

func (p *controlParser) feed(line []byte) (controlEvent, bool) {
	if p.inBlock {
		if number, ok, isEnd := blockEnd(line); isEnd && number == p.block {
			p.inBlock = false
			lines := p.body
			p.body = nil
			return controlEvent{kind: eventReply, number: number, ok: ok, lines: lines}, true
		}
		p.body = append(p.body, string(line))
		return controlEvent{}, false
	}
	if len(line) == 0 || line[0] != '%' {
		return controlEvent{}, false
	}
	name, rest, _ := bytes.Cut(line[1:], []byte(" "))
	switch string(name) {
	case "output":
		pane, data, ok := bytes.Cut(rest, []byte(" "))
		if !ok {
			return controlEvent{}, false
		}
		return controlEvent{kind: eventOutput, pane: string(pane), bytes: unescapeOutput(data)}, true
	case "extended-output":
		pane, tail, ok := bytes.Cut(rest, []byte(" "))
		if !ok {
			return controlEvent{}, false
		}
		_, data, ok := bytes.Cut(tail, []byte(" : "))
		if !ok {
			return controlEvent{}, false
		}
		return controlEvent{kind: eventOutput, pane: string(pane), bytes: unescapeOutput(data)}, true
	case "begin":
		f := strings.Fields(string(rest))
		if len(f) < 3 {
			return controlEvent{}, false
		}
		number, err := strconv.Atoi(f[1])
		if err != nil {
			return controlEvent{}, false
		}
		flags, _ := strconv.Atoi(f[2])
		p.inBlock, p.block, p.body = true, number, nil
		return controlEvent{kind: eventBegin, number: number, mine: flags&1 == 1}, true
	case "exit":
		return controlEvent{kind: eventExit, reason: string(rest)}, true
	}
	return controlEvent{}, false
}

func blockEnd(line []byte) (int, bool, bool) {
	var ok bool
	switch {
	case bytes.HasPrefix(line, []byte("%end ")):
		ok = true
	case bytes.HasPrefix(line, []byte("%error ")):
		ok = false
	default:
		return 0, false, false
	}
	f := strings.Fields(string(line))
	if len(f) < 3 {
		return 0, false, false
	}
	number, err := strconv.Atoi(f[2])
	if err != nil {
		return 0, false, false
	}
	return number, ok, true
}

func unescapeOutput(in []byte) []byte {
	out := make([]byte, 0, len(in))
	for i := 0; i < len(in); i++ {
		c := in[i]
		if c == '\\' && i+3 < len(in) && isOctal(in[i+1]) && isOctal(in[i+2]) && isOctal(in[i+3]) {
			out = append(out, (in[i+1]-'0')<<6|(in[i+2]-'0')<<3|(in[i+3]-'0'))
			i += 3
			continue
		}
		if c == '\\' && i+1 < len(in) && in[i+1] == '\\' {
			out = append(out, '\\')
			i++
			continue
		}
		out = append(out, c)
	}
	return out
}

func isOctal(c byte) bool {
	return c >= '0' && c <= '7'
}

func shellParams(r *http.Request, id string) (any, error) {
	var body struct {
		Worktree string `json:"worktree"`
	}
	if r.ContentLength != 0 {
		if err := decodeBody(r, &body); err != nil {
			return nil, err
		}
	}
	return rpc.ShellParams{Session: id, Worktree: body.Worktree}, nil
}

func nvimParams(r *http.Request, id string) (any, error) {
	var body struct {
		Worktree string `json:"worktree"`
	}
	if r.ContentLength != 0 {
		if err := decodeBody(r, &body); err != nil {
			return nil, err
		}
	}
	return rpc.NvimParams{Session: id, Worktree: body.Worktree}, nil
}
