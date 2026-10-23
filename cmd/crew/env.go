package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"syscall"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const envUsage = "usage: crew env list | show <env> | create <env> [--kind custom|local] [--part p]... [--git-name n] [--git-email e] | set <env> <VAR> (the value comes from stdin or a prompt) | set <env> [--part p]... [--git-name n] [--git-email e] | unset <env> <VAR> | login <env> | ssh-key <env> [--make|--rotate|--confirm|--import] | delete <env> | exec [<env>] -- <program> [args...]"

func runEnv(args []string, stdout, stderr io.Writer) int {
	if len(args) > 0 && args[0] == "exec" {
		return execInEnv(args, stderr)
	}
	if !envArgsOK(args) {
		fmt.Fprintln(stderr, envUsage)
		return 2
	}
	if args[0] == "login" {
		fmt.Fprintf(stderr, "crew env login: this runs claude setup-token in environment %s. Then store the token with crew env set %s CLAUDE_CODE_OAUTH_TOKEN.\n", args[1], args[1])
		return execInEnv(envLoginArgv(args[1]), stderr)
	}
	if err := envCLI(args, stdout); err != nil {
		fmt.Fprintf(stderr, "crew env %s: %v\n", args[0], err)
		return 1
	}
	return 0
}

func execInEnv(args []string, stderr io.Writer) int {
	rest := args[1:]
	sep := slices.Index(rest, "--")
	if sep < 0 || sep > 1 || sep == len(rest)-1 {
		fmt.Fprintln(stderr, envUsage)
		return 2
	}
	name := ""
	if sep == 1 {
		name = rest[0]
	}
	argv := rest[sep+1:]
	home, err := rpc.Home()
	if err != nil {
		fmt.Fprintf(stderr, "crew env exec: %v\n", err)
		return 1
	}
	environ, err := envFor(envstore.Store{Home: home}, name, os.Environ())
	if err != nil {
		fmt.Fprintf(stderr, "crew env exec: %v\n", err)
		return 1
	}
	if self, err := os.Executable(); err == nil {
		cwd, _ := os.Getwd()
		if err := seedEnv(envstore.Store{Home: home}, name, environ, cwd, self); err != nil {
			fmt.Fprintf(stderr, "crew env exec: environment %s: set up the harness dir: %v\n", envLabel(name), err)
		}
	}
	program, err := exec.LookPath(argv[0])
	if err != nil {
		fmt.Fprintf(stderr, "crew env exec: environment %s: %s is not on PATH\n", envLabel(name), argv[0])
		return 127
	}
	err = syscall.Exec(program, argv, environ)
	fmt.Fprintf(stderr, "crew env exec: environment %s: run %s: %v\n", envLabel(name), argv[0], err)
	return 126
}

func envLabel(name string) string {
	if name == "" {
		return string(domain.EnvLocal)
	}
	return name
}

func envFor(store envstore.Store, name string, environ []string) ([]string, error) {
	env, err := store.Get(name)
	if err != nil {
		return nil, err
	}
	if env.Home == "" {
		return environ, nil
	}
	secrets, err := store.Secrets(env.Name)
	if err != nil {
		return nil, err
	}
	return domain.BuildEnv(env, secrets, environ), nil
}
