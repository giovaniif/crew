package daemon_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func identityDaemon(t *testing.T) (*rpc.Client, string) {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(globalMates), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := &countingProbe{facts: app.LocalFacts{GitName: "TEST Owner", GitHub: true, Claude: true}}
	_, sock := start(t, &memStore{}, daemon.WithWorkspaces(shop, shopGit), daemon.WithConfig(path),
		daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithLocalProbe(probe), daemon.WithMachine("devbox"))
	c := dial(t, sock)
	if _, err := c.WorkspaceAdd(context.Background(), "/shop"); err != nil {
		t.Fatal(err)
	}
	return c, path
}

func machineID(t *testing.T, c *rpc.Client) string {
	t.Helper()
	st, err := c.Status(context.Background())
	if err != nil || st.Machine == nil {
		t.Fatalf("status %+v %v", st, err)
	}
	return st.Machine.ID
}

func TestEnvironmentListGivesTheMachineTheIdentitiesAndTheFoundLogins(t *testing.T) {
	c, _ := identityDaemon(t)
	ctx := context.Background()
	if _, err := envCall(c, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub}}); err != nil {
		t.Fatal(err)
	}
	if _, err := envCall(c, rpc.MethodIdentitySetSecret, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: envTestSecret}); err != nil {
		t.Fatal(err)
	}
	var got rpc.EnvironmentList
	if err := c.Call(ctx, rpc.MethodEnvironmentList, struct{}{}, &got); err != nil {
		t.Fatal(err)
	}
	if got.Machine.ID != machineID(t, c) || got.Machine.Name != "devbox" {
		t.Errorf("machine %+v", got.Machine)
	}
	if len(got.Identities) != 2 || got.Identities[0].Name != domain.IdentityYours || got.Identities[1].Name != "bot" {
		t.Fatalf("identities %+v", got.Identities)
	}
	if set, _ := secretSet(got.Identities[1], "GH_TOKEN"); !set {
		t.Errorf("GH_TOKEN is not set: %+v", got.Identities[1])
	}
	if got.Found == nil || got.Found.GitName != "TEST Owner" || !got.Found.GitHub {
		t.Errorf("found %+v", got.Found)
	}
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), "zzenvsecretzz") {
		t.Fatal("the answer holds a secret value")
	}
}

func TestIdentityRemoveRefusesYoursAndRemovesASeparateIdentity(t *testing.T) {
	c, _ := identityDaemon(t)
	var rerr *rpc.Error
	if _, err := envCall(c, rpc.MethodIdentityRemove, rpc.EnvNameParams{Name: domain.IdentityYours}); !errors.As(err, &rerr) || rerr.Code != rpc.CodeBadRequest {
		t.Fatalf("remove yours: %v", err)
	}
	if _, err := envCall(c, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom}); err != nil {
		t.Fatal(err)
	}
	if _, err := envCall(c, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Parts: []domain.EnvPart{domain.EnvGit}}); err != nil {
		t.Fatalf("set again: %v", err)
	}
	if _, err := envCall(c, rpc.MethodIdentityRemove, rpc.EnvNameParams{Name: "bot"}); err != nil {
		t.Fatal(err)
	}
	if _, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"}); err == nil {
		t.Fatal("bot stays")
	}
}

func TestMateSetTakesAnEnvironmentOfThisMachineOnly(t *testing.T) {
	c, path := identityDaemon(t)
	ctx := context.Background()
	if _, err := envCall(c, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom}); err != nil {
		t.Fatal(err)
	}
	m := rpc.Mate{Name: "ada", Prompt: "p", Agent: "claude", Enabled: true}
	var rerr *rpc.Error
	err := c.Call(ctx, rpc.MethodMateSet, rpc.MateSetParams{Mate: m, Environment: &rpc.MateEnvironment{MachineID: "m-other", IdentityID: "bot"}}, nil)
	if !errors.As(err, &rerr) || rerr.Code != rpc.CodeWrongMachine {
		t.Fatalf("other machine: %v", err)
	}
	var saved domain.Mate
	if err := c.Call(ctx, rpc.MethodMateSet, rpc.MateSetParams{Mate: m, Environment: &rpc.MateEnvironment{MachineID: machineID(t, c), IdentityID: "bot"}}, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Env != "bot" {
		t.Errorf("saved %+v", saved)
	}
	src, _ := os.ReadFile(path)
	if !strings.Contains(string(src), `identity_id = "bot"`) {
		t.Fatalf("config:\n%s", src)
	}
}

func TestTheOldEnvMethodsStillAnswer(t *testing.T) {
	c, _ := identityDaemon(t)
	var list rpc.EnvList
	if err := c.Call(context.Background(), rpc.MethodEnvList, struct{}{}, &list); err != nil {
		t.Fatal(err)
	}
	if _, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom}); err != nil {
		t.Fatal(err)
	}
}
