package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"time"
)

const controlExitWait = 2 * time.Second

type controlProcess struct {
	io.Reader
	io.Writer
	stdin  io.Closer
	stdout io.Closer
	cmd    *exec.Cmd
	done   chan struct{}
}

func startControl(_ context.Context, argv []string) (io.ReadWriteCloser, error) {
	if len(argv) == 0 {
		return nil, errors.New("the daemon sent no tmux command")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, w, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.Stdout = w
	err = cmd.Start()
	_ = w.Close()
	if err != nil {
		_ = stdout.Close()
		return nil, err
	}
	p := &controlProcess{Reader: stdout, Writer: stdin, stdin: stdin, stdout: stdout, cmd: cmd, done: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		close(p.done)
	}()
	return p, nil
}

func (p *controlProcess) Close() error {
	_ = p.stdin.Close()
	select {
	case <-p.done:
	case <-time.After(controlExitWait):
		_ = p.cmd.Process.Kill()
		<-p.done
	}
	return p.stdout.Close()
}
