package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/version"
)

func TestVersionTellsAboutNewerRelease(t *testing.T) {
	var out bytes.Buffer
	latest := func(context.Context) (string, error) { return "v0.1.0-alpha.3", nil }
	if code := runVersion("v0.1.0-alpha.2", "abc", latest, false, &out); code != 0 {
		t.Fatalf("exit %d", code)
	}
	got := out.String()
	for _, want := range []string{"crew v0.1.0-alpha.2 (commit abc)", "v0.1.0-alpha.3 is available", "crew daemon stop"} {
		if !strings.Contains(got, want) {
			t.Errorf("output %q lacks %q", got, want)
		}
	}
}

func TestVersionInTheAppBundleSendsTheUpgradeToTheApp(t *testing.T) {
	var out bytes.Buffer
	latest := func(context.Context) (string, error) { return "v0.1.0-beta.2", nil }
	runVersion("v0.1.0-beta.1", "abc", latest, true, &out)
	got := out.String()
	for _, want := range []string{"v0.1.0-beta.2 is available", "the crew app"} {
		if !strings.Contains(got, want) {
			t.Errorf("output %q lacks %q", got, want)
		}
	}
	if strings.Contains(got, "README") {
		t.Errorf("output %q tells a bundled crew to use the install script", got)
	}
}

func TestBundledCrewIsNextToTheDesktopApp(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "crew")
	if inAppBundle(exe) {
		t.Fatal("a crew without crew-desktop is not bundled")
	}
	for _, name := range []string{"crew-desktop", "crew-desktop.exe"} {
		app := filepath.Join(dir, name)
		if err := os.WriteFile(app, nil, 0o755); err != nil {
			t.Fatal(err)
		}
		if !inAppBundle(exe) {
			t.Errorf("crew next to %s is not bundled", name)
		}
		os.Remove(app)
	}
}

func TestVersionCheckSkippedByEnv(t *testing.T) {
	t.Setenv("CREW_HOME", t.TempDir())
	t.Setenv("CREW_NO_UPDATE_CHECK", "1")
	if _, err := latestRelease(context.Background()); !errors.Is(err, errUpdateCheckOff) {
		t.Fatalf("err = %v, want errUpdateCheckOff", err)
	}
}

func TestVersionQuietWhenCurrentOrCheckFails(t *testing.T) {
	for _, latest := range []func(context.Context) (string, error){
		func(context.Context) (string, error) { return "v0.1.0-alpha.2", nil },
		func(context.Context) (string, error) { return "", errors.New("offline") },
	} {
		var out bytes.Buffer
		runVersion("v0.1.0-alpha.2", "abc", latest, false, &out)
		if got := out.String(); got != "crew v0.1.0-alpha.2 (commit abc)\n" {
			t.Errorf("output = %q", got)
		}
	}
}

func TestVersionBuildPrintsTheHandshakeBuildOnly(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"version", "--build"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	if got, want := out.String(), version.String()+"\n"; got != want {
		t.Fatalf("output %q, want %q", got, want)
	}
}
