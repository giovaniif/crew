package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/charmbracelet/x/term"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const envApplies = "changes apply at the next start or resume of a mate; a running agent does not restart"

type envIO struct {
	Out        io.Writer
	ReadSecret func(label string) (string, error)
	ReadAll    func() ([]byte, error)
}

var envSSHKeyFlags = map[string]string{"--make": rpc.EnvSSHKeyMake, "--rotate": rpc.EnvSSHKeyRotate, "--confirm": rpc.EnvSSHKeyConfirm, "--import": rpc.EnvSSHKeyImport}

func envArgsOK(args []string) bool {
	if len(args) == 0 || len(args) > 1 && isHelpFlag(args[1]) {
		return false
	}
	noHelp := !slices.ContainsFunc(args[1:], isHelpFlag)
	switch args[0] {
	case "list":
		return len(args) == 1
	case "show", "delete", "login":
		return len(args) == 2
	case "create":
		return len(args) >= 2 && noHelp
	case "set":
		return len(args) >= 3 && noHelp
	case "unset":
		return len(args) == 3
	case "ssh-key":
		if len(args) == 3 {
			_, ok := envSSHKeyFlags[args[2]]
			return ok
		}
		return len(args) == 2
	}
	return false
}

func envLoginArgv(name string) []string {
	return []string{"exec", name, "--harness", "claude", "--", "claude", "setup-token"}
}

func envCLI(args []string, stdout io.Writer) error {
	home, err := rpc.Home()
	if err != nil {
		return err
	}
	ctx := context.Background()
	c, err := connect(ctx, home)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	eio := envIO{Out: stdout, ReadAll: func() ([]byte, error) { return io.ReadAll(os.Stdin) }}
	if term.IsTerminal(os.Stdin.Fd()) {
		eio.ReadSecret = terminalSecretReader(os.Stdin.Fd(), os.Stderr)
	} else {
		eio.ReadSecret = lineSecretReader(bufio.NewReader(os.Stdin), io.Discard)
	}
	return envCommand(ctx, c, eio, args)
}

type partList []domain.EnvPart

func (p *partList) String() string { return fmt.Sprint(*p) }
func (p *partList) Set(v string) error {
	*p = append(*p, domain.EnvPart(v))
	return nil
}

func envCommand(ctx context.Context, c mateCaller, eio envIO, args []string) error {
	var info rpc.EnvInfo
	switch args[0] {
	case "list":
		var list rpc.EnvList
		if err := c.Call(ctx, rpc.MethodEnvList, struct{}{}, &list); err != nil {
			return err
		}
		printEnvs(eio.Out, list)
		return nil
	case "show":
		if err := c.Call(ctx, rpc.MethodEnvShow, rpc.EnvNameParams{Name: args[1]}, &info); err != nil {
			return err
		}
		printEnv(eio.Out, info)
		return nil
	case "delete":
		if err := c.Call(ctx, rpc.MethodEnvDelete, rpc.EnvNameParams{Name: args[1]}, &info); err != nil {
			return err
		}
		fmt.Fprintf(eio.Out, "deleted %s\n", args[1])
		return nil
	case "create":
		p, err := parseEnvCreate(args[1], args[2:])
		if err != nil {
			return err
		}
		if err := c.Call(ctx, rpc.MethodEnvCreate, p, &info); err != nil {
			return err
		}
		fmt.Fprintf(eio.Out, "created %s (%s)\n", p.Name, p.Kind)
		return nil
	case "unset":
		if err := c.Call(ctx, rpc.MethodEnvUnset, rpc.EnvUnsetParams{Name: args[1], Secret: args[2]}, &info); err != nil {
			return err
		}
		fmt.Fprintf(eio.Out, "removed %s from %s; %s\n", args[2], args[1], envApplies)
		return nil
	case "set":
		return envSet(ctx, c, eio, args[1], args[2:])
	case "ssh-key":
		return envSSHKey(ctx, c, eio, args)
	}
	return fmt.Errorf("unknown command %q", args[0])
}

func parseEnvCreate(name string, args []string) (rpc.EnvCreateParams, error) {
	fs := flag.NewFlagSet("env create", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var parts partList
	kind := fs.String("kind", string(domain.EnvCustom), "")
	fs.Var(&parts, "part", "")
	gitName := fs.String("git-name", "", "")
	gitEmail := fs.String("git-email", "", "")
	if err := fs.Parse(args); err != nil {
		return rpc.EnvCreateParams{}, err
	}
	if fs.NArg() > 0 {
		return rpc.EnvCreateParams{}, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	return rpc.EnvCreateParams{Name: name, Kind: domain.EnvKind(*kind), Parts: parts, GitName: *gitName, GitEmail: *gitEmail}, nil
}

func envSet(ctx context.Context, c mateCaller, eio envIO, name string, args []string) error {
	var info rpc.EnvInfo
	if !strings.HasPrefix(args[0], "-") {
		if len(args) > 1 || strings.Contains(args[0], "=") {
			return errors.New("crew does not take a value on the command line, so it stays out of the shell history and ps; give only the name, and crew reads the value from stdin or a prompt")
		}
		value, err := eio.ReadSecret(fmt.Sprintf("Value of %s: ", args[0]))
		if err != nil {
			return err
		}
		if value == "" {
			return fmt.Errorf("no value for %s; to remove it, run crew env unset %s %s", args[0], name, args[0])
		}
		if err := c.Call(ctx, rpc.MethodEnvSet, rpc.EnvSetParams{Name: name, Secret: args[0], Value: value}, &info); err != nil {
			return err
		}
		fmt.Fprintf(eio.Out, "stored %s in %s; %s\n", args[0], name, envApplies)
		return nil
	}
	fs := flag.NewFlagSet("env set", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var parts partList
	fs.Var(&parts, "part", "")
	gitName := fs.String("git-name", "", "")
	gitEmail := fs.String("git-email", "", "")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	p := rpc.EnvSetParams{Name: name, GitName: *gitName, GitEmail: *gitEmail}
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "part" {
			list := []domain.EnvPart(parts)
			p.Parts = &list
		}
	})
	if err := c.Call(ctx, rpc.MethodEnvSet, p, &info); err != nil {
		return err
	}
	fmt.Fprintf(eio.Out, "saved %s; %s\n", name, envApplies)
	return nil
}

func envSSHKey(ctx context.Context, c mateCaller, eio envIO, args []string) error {
	p := rpc.EnvSSHKeyParams{Name: args[1]}
	if len(args) == 3 {
		p.Action = envSSHKeyFlags[args[2]]
	}
	if p.Action == rpc.EnvSSHKeyImport {
		data, err := eio.ReadAll()
		if err != nil {
			return err
		}
		p.PrivateKey = string(data)
	}
	var info rpc.EnvInfo
	if err := c.Call(ctx, rpc.MethodEnvSSHKey, p, &info); err != nil {
		return err
	}
	fmt.Fprintln(eio.Out, info.PublicKey)
	if info.NewPublicKey != "" {
		fmt.Fprintf(eio.Out, "new key, not in use yet. Add it on GitHub, then run crew env ssh-key %s --confirm:\n%s\n", args[1], info.NewPublicKey)
	}
	if p.Action != rpc.EnvSSHKeyShow {
		fmt.Fprintln(eio.Out, envApplies)
	}
	return nil
}

func envParts(parts []domain.EnvPart) string {
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = string(p)
	}
	return strings.Join(out, ",")
}

func printEnvs(w io.Writer, list rpc.EnvList) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tKIND\tPARTS\tSECRETS SET\tUSED BY")
	for _, e := range list.Envs {
		set := 0
		for _, s := range e.Secrets {
			if s.Set {
				set++
			}
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d of %d\t%s\n", e.Name, e.Kind, dash(envParts(e.Parts)), set, len(e.Secrets), dash(strings.Join(e.UsedBy, ",")))
	}
	_ = tw.Flush()
}

func printEnv(w io.Writer, e rpc.EnvInfo) {
	fmt.Fprintf(w, "name:    %s\nkind:    %s\n", e.Name, e.Kind)
	fmt.Fprintf(w, "parts:   %s\nused by: %s\n", dash(envParts(e.Parts)), dash(strings.Join(e.UsedBy, ",")))
	if e.PublicKey != "" {
		fmt.Fprintf(w, "ssh key: %s\n", e.PublicKey)
	}
	fmt.Fprintln(w, "secrets:")
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	for _, s := range e.Secrets {
		state := "not set"
		if s.Set {
			state = "set"
		}
		fmt.Fprintf(tw, "  %s\t%s\n", s.Name, state)
	}
	_ = tw.Flush()
}
