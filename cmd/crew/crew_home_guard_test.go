package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/rpc"
)

func TestTheTestsResolveACrewHomeInTheTemporaryHomeEvenWhenTheShellHasARealOne(t *testing.T) {
	home, err := rpc.Home()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(os.Getenv("HOME"), ".crew"); home != want {
		t.Fatalf("rpc.Home() = %q, want %q", home, want)
	}
	if !strings.HasPrefix(home, os.TempDir()) {
		t.Fatalf("rpc.Home() = %q is not in %q", home, os.TempDir())
	}
}
