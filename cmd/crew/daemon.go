package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/giovaniif/crew/internal/adapters/launchd"
	"github.com/giovaniif/crew/internal/adapters/loginshell"
	"github.com/giovaniif/crew/internal/adapters/systemd"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func runDaemon(args []string, stdout, stderr io.Writer) int {
	home, err := rpc.Home()
	if err != nil {
		fmt.Fprintf(stderr, "crew daemon: %v\n", err)
		return 1
	}
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "":
		err = foreground(home)
		if errors.Is(err, daemon.ErrAlreadyRunning) {
			if pid, ok := sameBuildRunning(home); ok {
				fmt.Fprintf(stderr, "crew daemon: a daemon of this build already runs (pid %d), so this one exits\n", pid)
				return 0
			}
		}
	case "start":
		err = start(home, stdout)
	case "status":
		err = status(home, stdout)
	case "stop":
		err = stop(home, stdout)
	default:
		fmt.Fprintf(stderr, "crew daemon: unknown subcommand %q\nusage: crew daemon [start|status|stop]\n", sub)
		return 2
	}
	if err != nil {
		fmt.Fprintf(stderr, "crew daemon: %v\n", err)
		return 1
	}
	return 0
}

func foreground(home string) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	adoptLoginPath(ctx)
	return daemon.Run(ctx, home)
}

func adoptLoginPath(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, loginPathWithin)
	defer cancel()
	login, err := loginshell.Path(ctx, os.Getenv("SHELL"))
	if err != nil {
		log.Printf("login shell PATH ignored: %v", err)
		return
	}
	if err := os.Setenv("PATH", domain.MergeLoginPath(os.Getenv("PATH"), login)); err != nil {
		log.Printf("login shell PATH ignored: %v", err)
	}
}

const loginPathWithin = time.Second

func sameBuildRunning(home string) (int, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), rpc.StartTimeout)
	defer cancel()
	c, err := rpc.Dial(rpc.SocketPath(home))
	if err != nil {
		return 0, false
	}
	st, err := c.Status(ctx)
	_ = c.Close()
	if err != nil {
		return 0, false
	}
	c, err = rpc.Dial(rpc.SocketPath(home))
	if err != nil {
		return 0, false
	}
	defer func() { _ = c.Close() }()
	var out json.RawMessage
	if err := c.Call(ctx, rpc.MethodWorkspaceList, nil, &out); err != nil {
		return 0, false
	}
	return st.PID, true
}

func installedService(home string, env func(string) string, self, goos string) (serveService, domain.DaemonStarter) {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return serveService{}, domain.StartFork
	}
	svc := daemonService(env, self, userHome, os.Getuid(), goos)
	var facts domain.DaemonService
	if svc.launchd {
		if spec, err := launchd.Inspect(svc.agent); err == nil {
			facts = domain.DaemonService{Installed: true, Home: spec.Env[domain.EnvName("HOME")], Exec: spec.Program}
		}
	} else if spec, err := systemd.Inspect(svc.unit); err == nil {
		facts = domain.DaemonService{Installed: true, Home: spec.Env[domain.EnvName("HOME")], Exec: spec.Program}
	}
	facts.Exec = resolved(facts.Exec)
	if abs, err := filepath.Abs(home); err == nil {
		home = abs
	}
	return svc, domain.DaemonStart(goos, facts, home, resolved(self))
}

func serviceStart(ctx context.Context, home string, env func(string) string, self, goos string) (bool, error) {
	svc, how := installedService(home, env, self, goos)
	switch how {
	case domain.StartSystemd:
		unit := svc.unit.Name + ".service"
		_ = systemd.Exec(ctx, "systemctl", "--user", "reset-failed", unit)
		return true, systemd.Exec(ctx, "systemctl", "--user", "start", unit)
	case domain.StartLaunchd:
		return true, launchd.Exec(ctx, "launchctl", "kickstart", fmt.Sprintf("gui/%d/%s", svc.agent.UID, svc.agent.Label))
	}
	return false, nil
}

func serviceStop(ctx context.Context, home string, env func(string) string, self, goos string) (bool, error) {
	svc, how := installedService(home, env, self, goos)
	if how != domain.StartSystemd {
		return false, nil
	}
	return true, systemd.Exec(ctx, "systemctl", "--user", "stop", svc.unit.Name+".service")
}

func spawn(home string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if started, err := serviceStart(context.Background(), home, os.Getenv, self, runtime.GOOS); started && err == nil {
		return nil
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(home, "daemon.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = log.Close() }()
	cmd := exec.Command(self, "daemon")
	cmd.Env = append(os.Environ(), domain.EnvName("HOME")+"="+home)
	cmd.Stdout, cmd.Stderr = log, log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func start(home string, stdout io.Writer) error {
	if c, err := rpc.Dial(rpc.SocketPath(home)); err == nil {
		defer func() { _ = c.Close() }()
		st, err := c.Status(context.Background())
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "crew daemon already running (pid %d)\n", st.PID)
		return nil
	}
	st, err := connectStatus(home)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "crew daemon started (pid %d)\n", st.PID)
	return nil
}

func connectStatus(home string) (rpc.Status, error) {
	ctx := context.Background()
	c, err := rpc.Connect(ctx, rpc.SocketPath(home), func() error { return spawn(home) })
	if err != nil {
		return rpc.Status{}, err
	}
	defer func() { _ = c.Close() }()
	return c.Status(ctx)
}

func status(home string, stdout io.Writer) error {
	c, err := rpc.Dial(rpc.SocketPath(home))
	if err != nil {
		return errNotRunning
	}
	defer func() { _ = c.Close() }()
	st, err := c.Status(context.Background())
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "pid %d\nuptime %s\nsessions %d\nworktrees %d\n",
		st.PID, time.Since(st.StartedAt).Round(time.Second), st.Sessions, st.Worktrees)
	return nil
}

var errNotRunning = errors.New("not running")

func stop(home string, stdout io.Writer) error {
	c, err := rpc.Dial(rpc.SocketPath(home))
	if err != nil {
		return errNotRunning
	}
	st, err := c.Status(context.Background())
	_ = c.Close()
	if err != nil {
		return err
	}
	if stopped, err := serviceStop(context.Background(), home, os.Getenv, selfOrEmpty(), runtime.GOOS); stopped && err == nil {
		if _, ok := daemon.ReadPID(home); !ok {
			fmt.Fprintf(stdout, "crew daemon stopped (pid %d)\n", st.PID)
			return nil
		}
	}
	if err := syscall.Kill(st.PID, syscall.SIGTERM); err != nil {
		return err
	}
	deadline := time.Now().Add(rpc.StartTimeout)
	for {
		if _, ok := daemon.ReadPID(home); !ok {
			fmt.Fprintf(stdout, "crew daemon stopped (pid %d)\n", st.PID)
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("pid %d did not exit within %v", st.PID, rpc.StartTimeout)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func selfOrEmpty() string {
	self, _ := os.Executable()
	return self
}
