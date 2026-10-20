package serve_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

type fakeControl struct {
	mu       sync.Mutex
	argv     [][]string
	commands []string
	screen   []string
	query    string
	failNext error
	out      *io.PipeWriter
	sent     chan string
	block    int
}

func newFakeControl() *fakeControl {
	return &fakeControl{
		screen: []string{"$ ls", "\x1b[32mmain.go\x1b[0m", ""},
		query:  "@3 80 3 2 1 1",
		sent:   make(chan string, 256),
	}
}

type controlPipe struct {
	io.Reader
	io.Writer
	closer func() error
}

func (p controlPipe) Close() error { return p.closer() }

func (c *fakeControl) start(_ context.Context, argv []string) (io.ReadWriteCloser, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.failNext != nil {
		err := c.failNext
		c.failNext = nil
		return nil, err
	}
	c.argv = append(c.argv, argv)
	toServe, fromControl := io.Pipe()
	fromServe, toControl := io.Pipe()
	c.out = fromControl
	go c.reply(fromServe, fromControl)
	return controlPipe{Reader: toServe, Writer: toControl, closer: func() error {
		_ = toControl.Close()
		return toServe.Close()
	}}, nil
}

func (c *fakeControl) reply(in *io.PipeReader, out *io.PipeWriter) {
	defer func() { _ = out.Close() }()
	var buf []byte
	chunk := make([]byte, 4096)
	for {
		n, err := in.Read(chunk)
		buf = append(buf, chunk[:n]...)
		for {
			i := bytes.IndexByte(buf, '\n')
			if i < 0 {
				break
			}
			line := string(buf[:i])
			buf = buf[i+1:]
			c.answer(out, line)
		}
		if err != nil {
			return
		}
	}
}

func (c *fakeControl) answer(out *io.PipeWriter, line string) {
	c.mu.Lock()
	c.commands = append(c.commands, line)
	c.block++
	n := c.block
	var body []string
	switch {
	case strings.HasPrefix(line, "capture-pane"):
		body = c.screen
	case strings.HasPrefix(line, "display-message"):
		body = []string{c.query}
	}
	c.mu.Unlock()
	var b strings.Builder
	fmt.Fprintf(&b, "%%begin 1700000000 %d 1\n", n)
	for _, l := range body {
		b.WriteString(l + "\n")
	}
	fmt.Fprintf(&b, "%%end 1700000000 %d 1\n", n)
	_, _ = out.Write([]byte(b.String()))
	c.sent <- line
}

func (c *fakeControl) emit(line string) {
	c.mu.Lock()
	out := c.out
	c.mu.Unlock()
	_, _ = out.Write([]byte(line + "\n"))
}

func (c *fakeControl) exit() {
	c.mu.Lock()
	out := c.out
	c.mu.Unlock()
	_ = out.Close()
}

type fatalT interface {
	Helper()
	Fatalf(string, ...any)
}

func (c *fakeControl) waitFor(t fatalT, prefix string) string {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case line := <-c.sent:
			if strings.HasPrefix(line, prefix) {
				return line
			}
		case <-timeout:
			t.Fatalf("no %q command reached tmux; saw %q", prefix, c.seen())
		}
	}
}

func (c *fakeControl) seen() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.commands...)
}
