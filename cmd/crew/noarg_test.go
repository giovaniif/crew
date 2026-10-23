package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestCrewWithNoArgumentsPointsToTheAppAndPrintsTheUsage(t *testing.T) {
	t.Setenv("CREW_HOME", "/nonexistent/crew-home")
	var stdout, stderr bytes.Buffer
	code := run(nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit %d", code)
	}
	out := stderr.String()
	if !strings.Contains(out, "open the crew app") || !strings.Contains(out, "usage: crew") {
		t.Fatalf("stderr %q", out)
	}
	if strings.Contains(out, "|tui|") {
		t.Fatalf("usage still names tui: %q", out)
	}
}

func TestCrewTuiIsAnUnknownCommand(t *testing.T) {
	t.Setenv("CREW_HOME", "/nonexistent/crew-home")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"tui"}, &stdout, &stderr); code != 2 || !strings.Contains(stderr.String(), "unknown command") {
		t.Fatalf("exit %d, stderr %q", code, stderr.String())
	}
}
