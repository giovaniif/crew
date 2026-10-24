package main

import (
	"bufio"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/daemon"
)

func TestDaemonLockHolderHelperProcess(t *testing.T) {
	home := os.Getenv("CREW_TEST_LOCK_HOLDER")
	if home == "" {
		t.Skip("helper process")
	}
	term := make(chan os.Signal, 1)
	signal.Notify(term, syscall.SIGTERM)
	lock, err := daemon.Acquire(home)
	if err != nil {
		os.Exit(3)
	}
	_, _ = os.Stdout.WriteString("held\n")
	<-term
	_ = lock.Release()
	os.Exit(0)
}

func holdDaemonLock(t *testing.T, home string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=TestDaemonLockHolderHelperProcess")
	cmd.Env = append(os.Environ(), "CREW_TEST_LOCK_HOLDER="+home)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line, _ := bufio.NewReader(out).ReadString('\n')
	if strings.TrimSpace(line) != "held" {
		t.Fatalf("helper said %q", line)
	}
	return cmd
}

func TestTakeOverStopsTheDaemonThatHoldsTheLockAndFreesIt(t *testing.T) {
	home := shortHome(t)
	holder := holdDaemonLock(t, home)
	done := make(chan error, 1)
	go func() { done <- holder.Wait() }()
	pid, err := takeOverDaemon(home)
	if err != nil {
		t.Fatal(err)
	}
	if pid != holder.Process.Pid {
		t.Fatalf("stopped pid %d, want %d", pid, holder.Process.Pid)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the holder still runs")
	}
	lock, err := daemon.Acquire(home)
	if err != nil {
		t.Fatalf("the lock is still held: %v", err)
	}
	_ = lock.Release()
}

func TestADaemonUnderTheServiceManagerTakesOverInsteadOfExitingZero(t *testing.T) {
	home := shortHome(t)
	t.Setenv("CREW_HOME", home)
	t.Setenv("SHELL", "")
	t.Setenv("INVOCATION_ID", "test")
	holdDaemonLock(t, home)
	var tries []string
	err := foregroundOrTakeOver(home, "linux", os.Getenv, func() error {
		tries = append(tries, "run")
		if len(tries) == 1 {
			return daemon.ErrAlreadyRunning
		}
		return nil
	}, func(string) (int, bool) { return 1, true })
	if err != nil || len(tries) != 2 {
		t.Fatalf("err %v tries %v", err, tries)
	}
	if os.Getenv("INVOCATION_ID") != "" {
		t.Fatal("the daemon keeps INVOCATION_ID for its children")
	}
}
