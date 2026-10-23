package main

import (
	"context"
	"fmt"
	"io"

	"github.com/giovaniif/crew/internal/rpc"
)

func isHelpArg(arg string) bool {
	return arg == "-h" || arg == "--help"
}

func runFocus(args []string, stderr io.Writer) int {
	if len(args) != 1 || isHelpArg(args[0]) {
		fmt.Fprintln(stderr, "usage: crew focus <session id>")
		return 2
	}
	home, err := rpc.Home()
	if err == nil {
		ctx := context.Background()
		var c *rpc.Client
		if c, err = connect(ctx, home); err == nil {
			err = c.FocusSession(ctx, args[0])
			_ = c.Close()
		}
	}
	if err != nil {
		fmt.Fprintf(stderr, "crew focus %s: %v\n", args[0], err)
		return 1
	}
	return 0
}
