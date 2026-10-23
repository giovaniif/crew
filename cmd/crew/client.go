package main

import (
	"context"
	"fmt"
	"io"
	"strconv"

	"github.com/giovaniif/crew/internal/rpc"
)

func connect(ctx context.Context, home string) (*rpc.Client, error) {
	return rpc.Connect(ctx, rpc.SocketPath(home), func() error { return spawn(home) })
}

func runDebugSeed(args []string, stdout, stderr io.Writer) int {
	codex := len(args) == 3 && args[2] == "--codex"
	if (len(args) != 2 && !codex) || args[0] != "seed" {
		fmt.Fprintln(stderr, debugUsage)
		return 2
	}
	n, err := strconv.Atoi(args[1])
	if err != nil || n < 1 {
		fmt.Fprintln(stderr, debugUsage)
		return 2
	}
	home, err := rpc.Home()
	if err != nil {
		fmt.Fprintf(stderr, "crew debug: %v\n", err)
		return 1
	}
	ctx := context.Background()
	c, err := connect(ctx, home)
	if err == nil {
		err = c.DebugSeed(ctx, rpc.DebugSeedParams{Count: n, Codex: codex})
		_ = c.Close()
	}
	if err != nil {
		fmt.Fprintf(stderr, "crew debug: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "seeded %d sessions\n", n)
	return 0
}
