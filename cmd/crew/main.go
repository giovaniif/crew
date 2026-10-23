package main

import (
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"slices"

	"github.com/giovaniif/crew/internal/rpc"
	"github.com/giovaniif/crew/internal/version"
)

var stubs []string

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || slices.Contains([]string{"daemon", "setup", "serve"}, args[0]) {
		migrateState(len(args) > 0 && args[0] == "setup", stderr)
	}
	if len(args) == 0 {
		fmt.Fprintln(stderr, "crew: open the crew app, or run `crew serve` for the web app.")
		usage(stderr)
		return 2
	}
	switch cmd := args[0]; {
	case cmd == "debug":
		return runDebug(args[1:], stdout, stderr)
	case cmd == "version" && len(args) == 2 && args[1] == "--build":
		fmt.Fprintln(stdout, version.String())
		return 0
	case cmd == "version":
		return runVersion(version.Version, buildCommit(), latestRelease, runningInAppBundle(), stdout)
	case cmd == "hook":
		home, _ := rpc.Home()
		return runHook(args[1:], os.Stdin, stdout, home, os.Getenv("TMUX_PANE"))
	case cmd == "setup":
		self, err := os.Executable()
		if err != nil {
			fmt.Fprintf(stderr, "crew setup: %v\n", err)
			return 1
		}
		return runSetup(args[1:], stdout, stderr, os.Getenv, self)
	case cmd == "statusline":
		home, _ := rpc.Home()
		return runStatusLine(args[1:], os.Stdin, stdout, home, os.Getenv("TMUX_PANE"))
	case cmd == "daemon":
		return runDaemon(args[1:], stdout, stderr)
	case cmd == "setup-worktree":
		return runSetupWorktree(args[1:], stdout, stderr)
	case cmd == "workspace":
		return runWorkspace(args[1:], stdout, stderr)
	case cmd == "cleanup":
		return runCleanup(args[1:], stdout, stderr)
	case cmd == "worktree":
		return runWorktree(args[1:], stdout, stderr)
	case cmd == "pr":
		return runPR(args[1:], stdout, stderr)
	case cmd == "new":
		return runNew(args[1:], stdout, stderr)
	case cmd == "review":
		return runReview(args[1:], stdout, stderr)
	case cmd == "notify":
		return runNotify(args[1:], stdout, stderr)
	case cmd == "automation":
		return runAutomation(args[1:], stdout, stderr)
	case cmd == "mate":
		return runMate(args[1:], stdout, stderr)
	case cmd == "env":
		return runEnv(args[1:], stderr)
	case cmd == "approval":
		return runApproval(args[1:], stdout, stderr)
	case cmd == "focus":
		return runFocus(args[1:], stderr)
	case cmd == "remote":
		return runRemote(args[1:], stdout, stderr)
	case cmd == "serve":
		return runServe(args[1:], stdout, stderr)
	case cmd == "browser":
		return runBrowser(args[1:], stdout, stderr)
	case cmd == "rpc":
		return runRPC(args[1:], os.Stdin, stdout, stderr)
	case slices.Contains(stubs, cmd):
		fmt.Fprintf(stderr, "crew %s: not implemented yet\n", cmd)
		return 1
	default:
		fmt.Fprintf(stderr, "crew: unknown command %q\n", cmd)
		usage(stderr)
		return 2
	}
}

func buildCommit() string {
	if version.Commit != "" {
		return version.Commit
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" {
				return s.Value
			}
		}
	}
	return "unknown"
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: crew [daemon|workspace|worktree|pr|setup|setup-worktree|debug|hook|statusline|new|automation|mate|env|approval|review|browser|focus|notify|remote|serve|rpc|cleanup|version [--build]]")
}
