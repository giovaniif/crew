//go:build integration

package serve_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/serve"
)

type tmuxServer struct {
	path   string
	socket string
	env    []string
}

func findTmux(t *testing.T) string {
	t.Helper()
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		p := filepath.Join(dir, "tmux")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	t.Skip("tmux is not installed")
	return ""
}

func newTmuxServer(t *testing.T) *tmuxServer {
	t.Helper()
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "TMUX=") && !strings.HasPrefix(kv, "TMUX_PANE=") {
			env = append(env, kv)
		}
	}
	s := &tmuxServer{path: findTmux(t), socket: fmt.Sprintf("crew-serve-term-%d", os.Getpid()), env: append(env, "TERM=xterm-256color")}
	t.Cleanup(func() { _, _ = s.run("kill-server") })
	return s
}

func (s *tmuxServer) argv(args ...string) []string {
	return append([]string{"tmux", "-L", s.socket, "-f", os.DevNull}, args...)
}

func (s *tmuxServer) run(args ...string) (string, error) {
	r, w, err := os.Pipe()
	if err != nil {
		return "", err
	}
	defer func() { _ = r.Close() }()
	p, err := os.StartProcess(s.path, s.argv(args...), &os.ProcAttr{Env: s.env, Files: []*os.File{nil, w, w}})
	_ = w.Close()
	if err != nil {
		return "", err
	}
	out, _ := io.ReadAll(r)
	st, err := p.Wait()
	if err != nil {
		return "", err
	}
	if !st.Success() {
		return string(out), fmt.Errorf("tmux %v: %s", args, out)
	}
	return string(out), nil
}

type process struct {
	io.Reader
	io.Writer
	stdin  *os.File
	stdout *os.File
	p      *os.Process
}

func (p *process) Close() error {
	_ = p.stdin.Close()
	_ = p.p.Kill()
	_, _ = p.p.Wait()
	return p.stdout.Close()
}

func (s *tmuxServer) control(_ context.Context, argv []string) (io.ReadWriteCloser, error) {
	inR, inW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	p, err := os.StartProcess(s.path, argv, &os.ProcAttr{Env: s.env, Files: []*os.File{inR, outW, outW}})
	_ = inR.Close()
	_ = outW.Close()
	if err != nil {
		return nil, err
	}
	return &process{Reader: outR, Writer: inW, stdin: inW, stdout: outR, p: p}, nil
}

func TestServeTerminalAgainstARealTmuxServer(t *testing.T) {
	tm := newTmuxServer(t)
	if _, err := tm.run("new-session", "-d", "-s", "crew", "-x", "80", "-y", "10", "sh"); err != nil {
		t.Fatal(err)
	}
	if _, err := tm.run("send-keys", "-t", "crew", "echo before-$((20+1))", "Enter"); err != nil {
		t.Fatal(err)
	}
	ids, err := tm.run("display-message", "-p", "-t", "crew", "#{pane_id} #{window_id}")
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(ids)
	pane, window := fields[0], fields[1]
	deadline := time.Now().Add(5 * time.Second)
	for {
		shown, _ := tm.run("capture-pane", "-p", "-t", pane)
		if strings.Contains(shown, "before-21") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the shell never printed: %q", shown)
		}
		time.Sleep(20 * time.Millisecond)
	}
	f := newFakeDaemon()
	f.devices[goodToken] = phone
	f.results[rpc.MethodClientNative] = rpc.NativeClient{Argv: tm.argv("-C", "attach-session", "-t", "=crew"), Session: "crew",
		Panes: []rpc.NativePane{{Pane: pane, Window: window, Cols: 80, Rows: 10}}}
	_, ts := startServer(t, f, serve.Config{URL: publicURL, Control: tm.control})
	c := openTerminal(t, ts, pane)
	typ, data := nextOf(t, c)
	var first struct {
		Screen struct {
			Pane   string `json:"pane"`
			Window string `json:"window"`
			Data   string `json:"data"`
		} `json:"screen"`
	}
	if typ != websocket.MessageText || json.Unmarshal(data, &first) != nil {
		t.Fatalf("first frame %v %s", typ, data)
	}
	if first.Screen.Pane != pane || first.Screen.Window != window || !strings.Contains(first.Screen.Data, "before-21") {
		t.Fatalf("screen %+v", first.Screen)
	}
	sendBinary(t, c, []byte("echo after-$((40+2))\r"))
	var got bytes.Buffer
	for !strings.Contains(got.String(), "after-42") {
		typ, data := nextOf(t, c)
		if typ != websocket.MessageBinary {
			t.Fatalf("frame %v %s", typ, data)
		}
		got.Write(data)
	}
}
