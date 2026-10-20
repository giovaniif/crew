package serve_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

var nativeArgv = []string{"tmux", "-L", "crew", "-C", "attach-session", "-t", "=crew-native-1-1"}

func terminalDaemon() *fakeDaemon {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodClientNative] = rpc.NativeClient{Argv: nativeArgv, Session: "crew-native-1-1",
		Panes: []rpc.NativePane{{Pane: "%5", Window: "@3", SessionID: "s1", Cols: 80, Rows: 3}}}
	return f
}

func startTerminal(t *testing.T, f *fakeDaemon, c *fakeControl) *httptest.Server {
	t.Helper()
	cfg := serve.Config{URL: publicURL}
	if c != nil {
		cfg.Control = c.start
	}
	_, ts := startServer(t, f, cfg)
	return ts
}

func dialTerminal(t *testing.T, ts *httptest.Server, pane, origin string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/terminal/" + strings.ReplaceAll(pane, "%", "%25")
	c, resp, err := websocket.Dial(ctx, u, &websocket.DialOptions{HTTPHeader: h})
	if c != nil {
		t.Cleanup(func() { _ = c.CloseNow() })
	}
	return c, resp, err
}

func openTerminal(t *testing.T, ts *httptest.Server, pane string) *websocket.Conn {
	t.Helper()
	c, _, err := dialTerminal(t, ts, pane, publicURL)
	if err != nil {
		t.Fatal(err)
	}
	send(t, c, map[string]any{"token": goodToken, "cols": 80, "rows": 3})
	return c
}

func nextOf(t *testing.T, c *websocket.Conn) (websocket.MessageType, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	typ, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return typ, data
}

func sendBinary(t *testing.T, c *websocket.Conn, b []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageBinary, b); err != nil {
		t.Fatal(err)
	}
}

func TestServeTerminalSendsTheScreenThenTheOutputOfThePane(t *testing.T) {
	f := terminalDaemon()
	ctl := newFakeControl()
	ts := startTerminal(t, f, ctl)
	c := openTerminal(t, ts, "%5")
	typ, data := nextOf(t, c)
	if typ != websocket.MessageText {
		t.Fatalf("the first frame is %v, want text", typ)
	}
	golden(t, "terminal-screen.json", data)
	if params := f.paramsOf(rpc.MethodClientNative); len(params) != 1 || string(params[0]) != `{"cols":80,"rows":3}` {
		t.Fatalf("client.native params %s", params)
	}
	if len(ctl.argv) != 1 || !slices.Equal(ctl.argv[0], nativeArgv) {
		t.Fatalf("control argv %q", ctl.argv)
	}
	if !slices.Contains(ctl.seen(), "refresh-client -C @3:80x3") {
		t.Fatalf("the pane was not sized: %q", ctl.seen())
	}
	ctl.emit(`%output %7 other pane`)
	ctl.emit(`%output %5 hi\015\012`)
	ctl.emit(`%extended-output %5 12 : back\134slash`)
	for _, want := range []string{"hi\r\n", `back\slash`} {
		typ, data := nextOf(t, c)
		if typ != websocket.MessageBinary || string(data) != want {
			t.Fatalf("got %v %q, want binary %q", typ, data, want)
		}
	}
}

func TestServeTerminalSendsKeysAndSizesToThePane(t *testing.T) {
	ctl := newFakeControl()
	ts := startTerminal(t, terminalDaemon(), ctl)
	c := openTerminal(t, ts, "%5")
	nextOf(t, c)
	sendBinary(t, c, []byte("ls\r"))
	if got := ctl.waitFor(t, "send-keys"); got != "send-keys -H -t %5 6c 73 0d" {
		t.Fatalf("keys %q", got)
	}
	sendBinary(t, c, []byte(strings.Repeat("a", 300)))
	first, second := ctl.waitFor(t, "send-keys"), ctl.waitFor(t, "send-keys")
	if strings.Count(first, " 61") != 256 || strings.Count(second, " 61") != 44 {
		t.Fatalf("a long paste was not split in chunks of 256: %d and %d keys", strings.Count(first, " 61"), strings.Count(second, " 61"))
	}
	send(t, c, map[string]any{"size": map[string]int{"cols": 120, "rows": 40}})
	if got := ctl.waitFor(t, "refresh-client"); got != "refresh-client -C @3:120x40" {
		t.Fatalf("size %q", got)
	}
}

func TestServeTerminalAnswersAnUnknownFrameWithAnError(t *testing.T) {
	ts := startTerminal(t, terminalDaemon(), newFakeControl())
	c := openTerminal(t, ts, "%5")
	nextOf(t, c)
	send(t, c, map[string]any{"size": map[string]int{"cols": 0, "rows": 40}})
	_, data := nextOf(t, c)
	golden(t, "terminal-error.json", data)
	send(t, c, map[string]any{"size": map[string]int{"cols": 100, "rows": 30}})
}

func TestServeTerminalClosesForAPaneTheClientCannotShow(t *testing.T) {
	ctl := newFakeControl()
	ts := startTerminal(t, terminalDaemon(), ctl)
	c := openTerminal(t, ts, "%9")
	if code, reason := closedWith(t, c, 2*time.Second); code != serve.CloseNoPane {
		t.Fatalf("close %d %q, want %d", code, reason, serve.CloseNoPane)
	}
	if len(ctl.argv) != 0 {
		t.Fatalf("tmux started for an unknown pane: %q", ctl.argv)
	}
}

func TestServeTerminalNeedsAValidTokenFirst(t *testing.T) {
	f := terminalDaemon()
	ctl := newFakeControl()
	ts := startTerminal(t, f, ctl)
	for _, tc := range []struct {
		first any
		code  websocket.StatusCode
	}{
		{map[string]any{"token": "wrong-token", "cols": 80, "rows": 3}, serve.CloseUnauthorized},
		{map[string]any{"cols": 80, "rows": 3}, serve.CloseBadHandshake},
	} {
		c, _, err := dialTerminal(t, ts, "%5", publicURL)
		if err != nil {
			t.Fatal(err)
		}
		send(t, c, tc.first)
		if code, reason := closedWith(t, c, 2*time.Second); code != tc.code {
			t.Fatalf("first frame %v: close %d %q, want %d", tc.first, code, reason, tc.code)
		}
	}
	if slices.Contains(f.methods(), rpc.MethodClientNative) || len(ctl.argv) != 0 {
		t.Fatalf("an unauthenticated terminal reached tmux: %q %q", f.methods(), ctl.argv)
	}
}

func TestServeTerminalRefusesAnotherOrigin(t *testing.T) {
	ts := startTerminal(t, terminalDaemon(), newFakeControl())
	_, resp, err := dialTerminal(t, ts, "%5", "https://evil.example")
	if err == nil {
		t.Fatal("the terminal opened")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("response %v", resp)
	}
}

func TestServeTerminalClosesWhenTmuxExits(t *testing.T) {
	ctl := newFakeControl()
	ts := startTerminal(t, terminalDaemon(), ctl)
	c := openTerminal(t, ts, "%5")
	nextOf(t, c)
	ctl.exit()
	if code, reason := closedWith(t, c, 2*time.Second); code != websocket.StatusTryAgainLater {
		t.Fatalf("close %d %q", code, reason)
	}
}

func TestServeTerminalClosesWhenTmuxCannotStart(t *testing.T) {
	ctl := newFakeControl()
	ctl.failNext = errors.New("tmux: not found")
	ts := startTerminal(t, terminalDaemon(), ctl)
	c := openTerminal(t, ts, "%5")
	if code, reason := closedWith(t, c, 2*time.Second); code != websocket.StatusTryAgainLater || !strings.Contains(reason, "tmux: not found") {
		t.Fatalf("close %d %q", code, reason)
	}
}

func TestServeTerminalClosesWithoutAControlRunner(t *testing.T) {
	ts := startTerminal(t, terminalDaemon(), nil)
	c := openTerminal(t, ts, "%5")
	if code, reason := closedWith(t, c, 2*time.Second); code != websocket.StatusTryAgainLater {
		t.Fatalf("close %d %q", code, reason)
	}
}

func TestServeShellAndNvimReturnThePaneToShow(t *testing.T) {
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodShellFocus] = rpc.ShellResult{Pane: "%8", Dir: "/home/me/api", Shown: true}
	f.results[rpc.MethodNvimToggle] = rpc.NvimResult{Pane: "%9", Socket: "/home/me/.crew/nvim/s1.sock", Shown: true}
	_, ts := startServer(t, f, serve.Config{URL: publicURL})
	status, body := do(t, ts, "POST", "/api/v1/sessions/s1/shell", goodToken, `{"worktree":"w1"}`)
	if status != http.StatusOK {
		t.Fatalf("shell: status %d %s", status, body)
	}
	golden(t, "terminal-shell.json", body)
	status, body = do(t, ts, "POST", "/api/v1/sessions/s1/nvim", goodToken, "")
	if status != http.StatusOK {
		t.Fatalf("nvim: status %d %s", status, body)
	}
	golden(t, "terminal-nvim.json", body)
	want := map[string]string{
		rpc.MethodShellFocus: `{"session":"s1","worktree":"w1"}`,
		rpc.MethodNvimToggle: `{"session":"s1"}`,
	}
	for method, params := range want {
		if got := f.paramsOf(method); len(got) != 1 || string(got[0]) != params {
			t.Fatalf("%s params %s, want %s", method, got, params)
		}
	}
	var out struct {
		Pane string `json:"pane"`
	}
	_ = json.Unmarshal(body, &out)
	if out.Pane != "%9" {
		t.Fatalf("pane %q", out.Pane)
	}
}
