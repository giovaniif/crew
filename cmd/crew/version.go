package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/giovaniif/crew/internal/adapters/github"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func runVersion(current, commit string, latest func(context.Context) (string, error), bundled bool, w io.Writer) int {
	fmt.Fprintf(w, "crew %s (commit %s)\n", current, commit)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tag, err := latest(ctx)
	if err != nil || !domain.NewerRelease(current, tag) {
		return 0
	}
	if bundled {
		fmt.Fprintf(w, "crew %s is available. Open the crew app and accept its update. The app updates this crew and restarts the daemon.\n", tag)
		return 0
	}
	fmt.Fprintf(w, "crew %s is available. Upgrade (see the README), then run `crew daemon stop` so the new binary starts a new daemon.\n", tag)
	return 0
}

var errUpdateCheckOff = errors.New("update check off")

func latestRelease(ctx context.Context) (string, error) {
	if domain.Env(os.Getenv, "NO_UPDATE_CHECK") != "" {
		return "", errUpdateCheckOff
	}
	home, err := rpc.Home()
	if err != nil {
		return "", err
	}
	c := github.ReleaseChecker{URL: github.ReleasesURL, CachePath: filepath.Join(home, "release.json")}
	return c.Latest(ctx)
}

func inAppBundle(exe string) bool {
	dir := filepath.Dir(exe)
	for _, name := range []string{"crew-desktop", "crew-desktop.exe"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

func runningInAppBundle() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return inAppBundle(exe)
}
