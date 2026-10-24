package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/charmbracelet/x/term"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

type mateCaller interface {
	Call(ctx context.Context, method string, params, out any) error
}

type mateAddIO struct {
	Out        io.Writer
	Open       func(url string) error
	ReadSecret func(label string) (string, error)
}

type mateAddOptions struct {
	Agent  string
	Prompt string
}

const defaultMateAgent = "claude"

func defaultMatePrompt(name string) string {
	return fmt.Sprintf("You are %s, a helpful teammate of the crew. Keep replies short, and ask when a request is not clear.", name)
}

func parseMateAdd(args []string) (string, mateAddOptions, error) {
	var opts mateAddOptions
	var names []string
	rest := args
	for len(rest) > 0 {
		fs := flag.NewFlagSet("mate add", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		fs.StringVar(&opts.Agent, "agent", "", "")
		fs.StringVar(&opts.Prompt, "prompt", "", "")
		if err := fs.Parse(rest); err != nil {
			return "", opts, err
		}
		names = append(names, fs.Args()[:min(1, fs.NArg())]...)
		rest = fs.Args()[min(1, fs.NArg()):]
	}
	if len(names) != 1 {
		return "", opts, errors.New("crew mate add needs exactly one name")
	}
	return names[0], opts, nil
}

func mateAdd(ctx context.Context, c mateCaller, mio mateAddIO, name string, opts mateAddOptions) error {
	err := c.Call(ctx, rpc.MethodMateShow, rpc.MateShowParams{Name: name}, &domain.Mate{})
	var rerr *rpc.Error
	switch {
	case err == nil:
		return fmt.Errorf("mate %q exists; change it with crew mate set %s, or add its tokens with crew mate tokens %s", name, name, name)
	case !errors.As(err, &rerr) || rerr.Code != rpc.CodeNotFound:
		return err
	}
	m := domain.Mate{Name: name, Agent: opts.Agent, Prompt: opts.Prompt, Enabled: true}
	if m.Agent == "" {
		m.Agent = defaultMateAgent
	}
	if m.Prompt == "" {
		m.Prompt = defaultMatePrompt(name)
	}
	if err := c.Call(ctx, rpc.MethodMateSet, rpc.MateSetParams{Mate: m}, &domain.Mate{}); err != nil {
		return err
	}
	fmt.Fprintf(mio.Out, "added %s. Start a conversation with crew mate new %s, or connect it to Slack with crew mate slack %s.\n", name, name, name)
	return nil
}

func mateSlack(ctx context.Context, c mateCaller, mio mateAddIO, name string, noOpen bool) error {
	var m domain.Mate
	if err := c.Call(ctx, rpc.MethodMateShow, rpc.MateShowParams{Name: name}, &m); err != nil {
		return err
	}
	if m.Name == "" {
		m.Name = name
	}
	writeMateSetup(mio.Out, m)
	if !noOpen {
		link := domain.MateManifestURL(domain.MateManifest(m))
		if mio.Open == nil || mio.Open(link) != nil {
			fmt.Fprintln(mio.Out, "crew could not open a browser. Please open this link yourself.")
		}
	}
	if err := askTokens(ctx, c, mio, name); err != nil {
		return fmt.Errorf("the mate %s is saved, but its tokens are not: %w; run crew mate tokens %s when you have them", name, err, name)
	}
	return nil
}

func parseMateNew(args []string) (rpc.MateNewParams, error) {
	var p rpc.MateNewParams
	var words []string
	rest := args
	for len(rest) > 0 {
		fs := flag.NewFlagSet("mate new", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		repo := fs.String("repo", p.Repo, "")
		if err := fs.Parse(rest); err != nil {
			return p, err
		}
		p.Repo = *repo
		if fs.NArg() == 0 {
			break
		}
		words = append(words, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if len(words) == 0 {
		return p, errors.New("crew mate new needs a name")
	}
	p.Name, p.Prompt = words[0], strings.Join(words[1:], " ")
	return p, nil
}

func mateNew(ctx context.Context, c mateCaller, out io.Writer, p rpc.MateNewParams) error {
	var s rpc.MateNewResult
	if err := c.Call(ctx, rpc.MethodMateNew, p, &s); err != nil {
		return err
	}
	if s.Added {
		fmt.Fprintf(out, "added to the conversation with %s: session %s\n", p.Name, s.ID)
		return nil
	}
	fmt.Fprintf(out, "started a new conversation with %s: session %s\n", p.Name, s.ID)
	return nil
}

func writeMateSetup(w io.Writer, m domain.Mate) {
	manifest := domain.MateManifest(m)
	fmt.Fprintf(w, "Slack app manifest for %s:\n\n%s\n", m.Name, manifest)
	fmt.Fprintf(w, "1. Open this link and make the app from the manifest:\n\n%s\n\n", domain.MateManifestURL(manifest))
	fmt.Fprintln(w, "2. Install the app in your workspace. A workspace admin may need to approve it first.")
	fmt.Fprintln(w, "3. Copy the bot token (xoxb-) from OAuth & Permissions.")
	fmt.Fprintln(w, "4. Make an app-level token (xapp-) with the scope connections:write in Basic Information, and copy it.")
	fmt.Fprintln(w)
}

func askTokens(ctx context.Context, c mateCaller, mio mateAddIO, name string) error {
	bot, err := mio.ReadSecret("Bot token (xoxb-...): ")
	if err != nil {
		return err
	}
	app, err := mio.ReadSecret("App token (xapp-...): ")
	if err != nil {
		return err
	}
	var status rpc.MateTokenStatus
	if err := c.Call(ctx, rpc.MethodMateSetTokens, rpc.MateSetTokensParams{Name: name, BotToken: bot, AppToken: app}, &status); err != nil {
		return err
	}
	fmt.Fprintf(mio.Out, "stored the tokens of %s\n", name)
	if err := mateClaim(ctx, c, mio.Out, name); err != nil {
		fmt.Fprintf(mio.Out, "crew could not make a claim code (%v). Run crew mate claim %s when the daemon runs.\n", err, name)
	}
	return nil
}

func mateClaim(ctx context.Context, c mateCaller, out io.Writer, name string) error {
	var claim rpc.MateClaim
	if err := c.Call(ctx, rpc.MethodMateClaim, rpc.MateClaimParams{Name: name}, &claim); err != nil {
		return err
	}
	fmt.Fprintf(out, "\nTo become the owner of %s, send this code to @%s in a direct message in Slack in the next 10 minutes:\n\n    %s\n\n", name, name, claim.Code)
	return nil
}

func mateTokens(ctx context.Context, c mateCaller, mio mateAddIO, name string, wipe bool) error {
	if wipe {
		var status rpc.MateTokenStatus
		if err := c.Call(ctx, rpc.MethodMateClearTokens, rpc.MateClearTokensParams{Name: name}, &status); err != nil {
			return err
		}
		fmt.Fprintf(mio.Out, "cleared the tokens of %s\n", name)
		return nil
	}
	if err := c.Call(ctx, rpc.MethodMateShow, rpc.MateShowParams{Name: name}, &domain.Mate{}); err != nil {
		return err
	}
	return askTokens(ctx, c, mio, name)
}

func lineSecretReader(in *bufio.Reader, out io.Writer) func(string) (string, error) {
	return func(label string) (string, error) {
		fmt.Fprint(out, label)
		line, err := in.ReadString('\n')
		if err != nil && line == "" {
			return "", err
		}
		return strings.TrimSpace(line), nil
	}
}

func terminalSecretReader(fd uintptr, out io.Writer) func(string) (string, error) {
	return func(label string) (string, error) {
		fmt.Fprint(out, label)
		data, err := term.ReadPassword(fd)
		fmt.Fprintln(out)
		return strings.TrimSpace(string(data)), err
	}
}

func openInBrowser(url string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return err
	}
	cmd := exec.Command(path, url)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func stdMateIO(stdout io.Writer) mateAddIO {
	mio := mateAddIO{Out: stdout, Open: openInBrowser}
	if term.IsTerminal(os.Stdin.Fd()) {
		mio.ReadSecret = terminalSecretReader(os.Stdin.Fd(), stdout)
	} else {
		mio.ReadSecret = lineSecretReader(bufio.NewReader(os.Stdin), stdout)
	}
	return mio
}
