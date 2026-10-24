package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/adapters/launchd"
	"github.com/giovaniif/crew/internal/adapters/loginshell"
	"github.com/giovaniif/crew/internal/adapters/onboard"
	"github.com/giovaniif/crew/internal/adapters/systemd"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const setupDaemonUsage = "usage: crew setup daemon [--remove | --check]"

const (
	daemonUnitName   = "crew-daemon"
	daemonAgentLabel = "dev.crew.daemon"
)

type daemonCheck struct {
	Installed bool   `json:"installed"`
	Running   bool   `json:"running"`
	Linger    bool   `json:"linger"`
	ExecOK    bool   `json:"exec_ok"`
	Failing   bool   `json:"failing"`
	Reason    string `json:"reason,omitempty"`

	HooksMissing []domain.HooksMissing `json:"hooks_missing"`
}

func runSetupDaemon(args []string, stdout, stderr io.Writer, env func(string) string, self, goos string) int {
	fs := flag.NewFlagSet("setup daemon", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	remove := fs.Bool("remove", false, "")
	check := fs.Bool("check", false, "")
	err := fs.Parse(args)
	switch {
	case err != nil:
	case fs.NArg() != 0:
		err = errors.New("takes no arguments, only flags")
	case *remove && *check:
		err = errors.New("--remove and --check go alone")
	case goos != "linux" && goos != "darwin":
		err = fmt.Errorf("%s is not supported, only linux and macOS", goos)
	}
	if err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: %v\n%s\n", err, setupDaemonUsage)
		return 2
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: %v\n", err)
		return 1
	}
	ctx := context.Background()
	svc := daemonService(env, self, userHome, os.Getuid(), goos)
	switch {
	case *check:
		return printDaemonCheck(ctx, svc, env, self, userHome, stdout, stderr)
	case *remove:
		removed, err := removeServe(ctx, svc)
		switch {
		case err != nil:
			fmt.Fprintf(stderr, "crew setup daemon: %v\n", err)
			return 1
		case removed:
			fmt.Fprintf(stdout, "stopped and removed %s\n", svc.path())
		default:
			fmt.Fprintf(stdout, "nothing to remove at %s\n", svc.path())
		}
		return 0
	}
	loginPath, err := loginshell.Path(ctx, env("SHELL"))
	if err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: reading the login shell's PATH: %v\n", err)
		return 1
	}
	if svc.launchd {
		svc.agent.Env["PATH"] = loginPath
	} else {
		svc.unit.Env["PATH"] = loginPath
	}
	path, backup, changed, err := installServe(ctx, svc)
	if err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: %v\n", err)
		return 1
	}
	if changed {
		fmt.Fprintf(stdout, "wrote and started %s; the daemon now runs at login and logs to %s\n", path, serveLog(svc))
		if backup != "" {
			fmt.Fprintf(stdout, "previous file saved as %s\n", backup)
		}
	} else {
		fmt.Fprintf(stdout, "already set up in %s\n", path)
	}
	if svc.launchd {
		return 0
	}
	for _, p := range staleCrewProcs("/proc") {
		fmt.Fprintf(stdout, "%s (pid %d) runs a replaced crew binary and can start a daemon outside the service; stop it with: kill %d\n", p.Command, p.PID, p.PID)
	}
	if on, err := lingerOn(ctx, env); err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: could not check linger: %v\n", err)
	} else if !on {
		fmt.Fprintf(stdout, "linger is off for %s: the daemon and every session stop at logout. Fix it with:\n  sudo loginctl enable-linger %s\n", env("USER"), env("USER"))
	}
	return 0
}

func daemonService(env func(string) string, self, userHome string, uid int, goos string) serveService {
	home := domain.Env(env, "HOME")
	if home == "" {
		home = rpc.DefaultHome(userHome)
	}
	if abs, err := filepath.Abs(home); err == nil {
		home = abs
	}
	program := []string{self, "daemon"}
	svcEnv := map[string]string{domain.EnvName("HOME"): home}
	log := filepath.Join(home, "daemon-service.log")
	if goos == "darwin" {
		return serveService{launchd: true, agent: launchd.Agent{
			Dir:     filepath.Join(userHome, "Library", "LaunchAgents"),
			Label:   daemonAgentLabel,
			Program: program,
			Env:     svcEnv,
			Log:     log,
			UID:     uid,

			KeepAliveOnFailure: true,
		}}
	}
	config := env("XDG_CONFIG_HOME")
	if config == "" {
		config = filepath.Join(userHome, ".config")
	}
	return serveService{unit: systemd.Unit{
		Dir:     filepath.Join(config, "systemd", "user"),
		Name:    daemonUnitName,
		Program: program,
		Env:     svcEnv,
		Log:     log,

		RestartOnFailure: true,
	}}
}

func printDaemonCheck(ctx context.Context, svc serveService, env func(string) string, self, userHome string, stdout, stderr io.Writer) int {
	var c daemonCheck
	c.HooksMissing = hooksMissing(ctx, env, self, userHome)
	switch _, err := os.Stat(svc.path()); {
	case err == nil:
		c.Installed = true
	case !errors.Is(err, os.ErrNotExist):
		fmt.Fprintf(stderr, "crew setup daemon: %v\n", err)
		return 1
	}
	if svc.launchd {
		c.Running = launchd.Exec(ctx, "launchctl", "print", fmt.Sprintf("gui/%d/%s", svc.agent.UID, svc.agent.Label)) == nil
		c.Linger = true
	} else {
		c.Running = systemd.Exec(ctx, "systemctl", "--user", "is-active", svc.unit.Name+".service") == nil
		on, err := lingerOn(ctx, env)
		if err != nil {
			fmt.Fprintf(stderr, "crew setup daemon: could not check linger: %v\n", err)
			return 1
		}
		c.Linger = on
		if c.Installed {
			c.ExecOK, c.Reason = unitHealth(ctx, svc.unit, self)
			c.Failing = c.Reason != ""
		}
	}
	if svc.launchd {
		c.ExecOK = c.Installed
		if spec, err := launchd.Inspect(svc.agent); err == nil && spec.KeepAliveAlways {
			c.Failing, c.Reason = true, domain.CleanExitRestartReason
		}
	}
	if err := json.NewEncoder(stdout).Encode(c); err != nil {
		fmt.Fprintf(stderr, "crew setup daemon: %v\n", err)
		return 1
	}
	return 0
}

func unitHealth(ctx context.Context, u systemd.Unit, self string) (bool, string) {
	spec, err := systemd.Inspect(u)
	if err != nil {
		return false, err.Error()
	}
	program := spec.Program
	facts := domain.DaemonUnit{ExecPath: resolved(program), Self: resolved(self), RestartsCleanExit: spec.Restart == "always"}
	if program != "" {
		info, err := os.Stat(program)
		facts.ExecExists = err == nil && !info.IsDir()
	}
	if state, err := systemd.Show(ctx, u, systemd.Output); err == nil {
		facts.Active, facts.Sub, facts.Restarts, facts.MainStatus, facts.Result = state.Active, state.Sub, state.Restarts, state.MainStatus, state.Result
	}
	return domain.DaemonUnitHealth(facts)
}

func resolved(path string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return path
}

func lingerOn(ctx context.Context, env func(string) string) (bool, error) {
	out, err := exec.CommandContext(ctx, "loginctl", "show-user", env("USER"), "-p", "Linger").Output()
	if err != nil {
		return false, fmt.Errorf("loginctl: %w", err)
	}
	return bytes.Equal(bytes.TrimSpace(out), []byte("Linger=yes")), nil
}

func hooksMissing(ctx context.Context, env func(string) string, self, userHome string) []domain.HooksMissing {
	home := domain.Env(env, "HOME")
	if home == "" {
		home = rpc.DefaultHome(userHome)
	}
	var custom []domain.Environment
	list, _ := envstore.Store{Home: home}.List()
	for _, e := range list {
		if e.Kind == domain.EnvCustom {
			custom = append(custom, e)
		}
	}
	out := onboard.FromEnv(home, self, env).Hooks(ctx, custom)
	if out == nil {
		out = []domain.HooksMissing{}
	}
	return out
}
