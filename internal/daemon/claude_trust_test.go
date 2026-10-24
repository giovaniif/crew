package daemon_test

import (
	"context"
	"errors"
	"testing"

	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestTheDaemonTellsAndSetsTheClaudeTrustOfAFolder(t *testing.T) {
	f := &fakeTrust{}
	_, sock := start(t, &memStore{}, daemon.WithClaudeTrust(f))
	c := dial(t, sock)
	ctx := context.Background()
	got, err := c.ClaudeTrust(ctx, "/srv/api")
	if err != nil || got != (rpc.ClaudeTrustStatus{Path: "/srv/api"}) {
		t.Fatalf("status = %+v, %v", got, err)
	}
	got, err = c.TrustClaude(ctx, "/srv/api")
	if err != nil || got != (rpc.ClaudeTrustStatus{Path: "/srv/api", Trusted: true}) {
		t.Fatalf("trust = %+v, %v", got, err)
	}
	var re *rpc.Error
	if _, err := c.TrustClaude(ctx, "relative"); !errors.As(err, &re) || re.Code != rpc.CodeBadRequest {
		t.Errorf("relative path err = %v", err)
	}
}
