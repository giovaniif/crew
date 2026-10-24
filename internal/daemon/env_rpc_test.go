package daemon_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/app"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const envTestSecret = "TEST-zzenvsecretzz"

func envDaemon(t *testing.T, body string) (*rpc.Client, string, string) {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	_, sock := start(t, &memStore{}, daemon.WithWorkspaces(shop, shopGit), daemon.WithConfig(path), daemon.WithEnvironments(envstore.Store{Home: home}))
	c := dial(t, sock)
	if _, err := c.WorkspaceAdd(context.Background(), "/shop"); err != nil {
		t.Fatal(err)
	}
	return c, path, home
}

func envCall(c *rpc.Client, method string, params any) (rpc.EnvInfo, error) {
	var got rpc.EnvInfo
	err := c.Call(context.Background(), method, params, &got)
	return got, err
}

func createBot(t *testing.T, c *rpc.Client) rpc.EnvInfo {
	t.Helper()
	got, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGit, domain.EnvGitHub, domain.EnvClaude}, GitName: "Bot", GitEmail: "bot@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func secretSet(info rpc.EnvInfo, name string) (bool, bool) {
	for _, s := range info.Secrets {
		if s.Name == name {
			return s.Set, true
		}
	}
	return false, false
}

func TestEnvCreateWritesTheDefinitionAndListsItsSecretsAsNotSet(t *testing.T) {
	c, path, home := envDaemon(t, globalMates)
	got := createBot(t, c)
	if got.Name != "bot" || got.Kind != domain.EnvCustom || len(got.Parts) != 3 {
		t.Errorf("answer %+v", got)
	}
	if set, ok := secretSet(got, "GH_TOKEN"); !ok || set {
		t.Errorf("GH_TOKEN in %+v", got.Secrets)
	}
	body, _ := os.ReadFile(path)
	if !strings.Contains(string(body), `name = "bot"`) {
		t.Errorf("config.toml:\n%s", body)
	}
	git, err := os.ReadFile(filepath.Join(home, "identities", "bot", "gitconfig"))
	if err != nil || !strings.Contains(string(git), "bot@example.com") {
		t.Errorf("gitconfig %q, %v", git, err)
	}
}

func TestEnvCreateRefusesAnExistingName(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	_, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvLocal})
	if callCode(err) != rpc.CodeBadRequest {
		t.Errorf("err = %v", err)
	}
}

func TestEnvCreateRefusesACustomEnvironmentNamedLocal(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	_, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "local", Kind: domain.EnvCustom})
	if callCode(err) != rpc.CodeBadRequest {
		t.Errorf("err = %v", err)
	}
}

func TestEnvSetStoresASecretAndNoAnswerOrLogHoldsTheValue(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	c, path, home := envDaemon(t, globalMates)
	createBot(t, c)
	got, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: envTestSecret})
	if err != nil {
		t.Fatal(err)
	}
	if set, _ := secretSet(got, "GH_TOKEN"); !set {
		t.Errorf("GH_TOKEN not set in %+v", got.Secrets)
	}
	data, err := os.ReadFile(filepath.Join(home, "secrets", "identity", "bot", "GH_TOKEN"))
	if err != nil || string(data) != envTestSecret {
		t.Errorf("secret file %q, %v", data, err)
	}
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "LINEAR_API_KEY", Value: envTestSecret}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, call := range []struct {
		method string
		params any
	}{
		{rpc.MethodEnvList, struct{}{}},
		{rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"}},
		{rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: envTestSecret}},
		{rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyMake}},
		{rpc.MethodMateList, struct{}{}},
	} {
		var raw json.RawMessage
		if err := c.Call(ctx, call.method, call.params, &raw); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "zzenvsecretzz") {
			t.Errorf("%s returned the secret: %s", call.method, raw)
		}
	}
	body, _ := os.ReadFile(path)
	if strings.Contains(string(body), "zzenvsecretzz") {
		t.Errorf("config.toml holds the secret:\n%s", body)
	}
	if strings.Contains(logs.String(), "zzenvsecretzz") {
		t.Errorf("the log holds the secret:\n%s", logs.String())
	}
}

func TestEnvSetRefusesADeniedNameWithoutEchoingTheValue(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	_, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "LD_PRELOAD", Value: envTestSecret})
	if callCode(err) != rpc.CodeBadRequest {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "zzenvsecretzz") {
		t.Errorf("the error shows the secret: %v", err)
	}
}

func TestEnvSetRefusesAnEmptyValue(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN"}); callCode(err) != rpc.CodeBadRequest {
		t.Errorf("err = %v", err)
	}
}

func TestEnvSetChangesThePartsOfACustomEnvironment(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	parts := []domain.EnvPart{domain.EnvCodex}
	got, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Parts: &parts})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Parts, parts) {
		t.Errorf("parts %v", got.Parts)
	}
	if _, ok := secretSet(got, "OPENAI_API_KEY"); !ok {
		t.Errorf("secrets %+v", got.Secrets)
	}
}

func TestLocalEnvironmentTakesOnlyExtraSecretVariables(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	parts := []domain.EnvPart{domain.EnvGitHub}
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "local", Parts: &parts}); callCode(err) != rpc.CodeBadRequest {
		t.Errorf("parts on local: err = %v", err)
	}
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "local", GitName: "Bot", GitEmail: "bot@example.com"}); callCode(err) != rpc.CodeBadRequest {
		t.Errorf("git on local: err = %v", err)
	}
	if _, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "local", Action: rpc.EnvSSHKeyMake}); callCode(err) != rpc.CodeBadRequest {
		t.Errorf("ssh key on local: err = %v", err)
	}
	got, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "local", Secret: "LINEAR_API_KEY", Value: envTestSecret})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != domain.EnvLocal {
		t.Errorf("kind %s", got.Kind)
	}
	if set, _ := secretSet(got, "LINEAR_API_KEY"); !set {
		t.Errorf("secrets %+v", got.Secrets)
	}
}

func TestEnvListShowsLocalAndTheMatesThatUseEachEnvironment(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	if err := c.Call(context.Background(), rpc.MethodMateSet, rpc.MateSetParams{Mate: domain.Mate{Name: "reviewer", Prompt: "Review code.", Agent: "claude", Repos: []string{"api"}, Owner: "U012ABCDEF", Env: "bot", Enabled: true}}, nil); err != nil {
		t.Fatal(err)
	}
	var list rpc.EnvList
	if err := c.Call(context.Background(), rpc.MethodEnvList, struct{}{}, &list); err != nil {
		t.Fatal(err)
	}
	names := map[string]rpc.EnvInfo{}
	for _, e := range list.Envs {
		names[e.Name] = e
	}
	if _, ok := names["local"]; !ok {
		t.Errorf("no local in %+v", list.Envs)
	}
	if !slices.Equal(names["bot"].UsedBy, []string{"reviewer"}) {
		t.Errorf("bot used by %v", names["bot"].UsedBy)
	}
}

func TestEnvUnsetClearsASecret(t *testing.T) {
	c, _, home := envDaemon(t, globalMates)
	createBot(t, c)
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: envTestSecret}); err != nil {
		t.Fatal(err)
	}
	got, err := envCall(c, rpc.MethodEnvUnset, rpc.EnvUnsetParams{Name: "bot", Secret: "GH_TOKEN"})
	if err != nil {
		t.Fatal(err)
	}
	if set, _ := secretSet(got, "GH_TOKEN"); set {
		t.Errorf("still set: %+v", got.Secrets)
	}
	if _, err := os.Stat(filepath.Join(home, "secrets", "identity", "bot", "GH_TOKEN")); err == nil {
		t.Error("the file stays")
	}
}

func TestEnvDeleteRefusesWhileAMateUsesIt(t *testing.T) {
	c, path, _ := envDaemon(t, globalMates)
	createBot(t, c)
	if err := c.Call(context.Background(), rpc.MethodMateSet, rpc.MateSetParams{Mate: domain.Mate{Name: "reviewer", Prompt: "Review code.", Agent: "claude", Repos: []string{"api"}, Owner: "U012ABCDEF", Env: "bot", Enabled: true}}, nil); err != nil {
		t.Fatal(err)
	}
	_, err := envCall(c, rpc.MethodEnvDelete, rpc.EnvNameParams{Name: "bot"})
	if callCode(err) != rpc.CodeInUse || !strings.Contains(err.Error(), "reviewer") {
		t.Errorf("err = %v", err)
	}
	body, _ := os.ReadFile(path)
	if !strings.Contains(string(body), `name = "bot"`) {
		t.Errorf("the env went:\n%s", body)
	}
}

func TestEnvDeleteRemovesAnUnusedEnvironment(t *testing.T) {
	c, _, home := envDaemon(t, globalMates)
	createBot(t, c)
	if _, err := envCall(c, rpc.MethodEnvDelete, rpc.EnvNameParams{Name: "bot"}); err != nil {
		t.Fatal(err)
	}
	if _, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"}); callCode(err) != rpc.CodeNotFound {
		t.Errorf("show after delete: err = %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, "identities", "bot")); err == nil {
		t.Error("the env dir stays")
	}
}

func TestEnvShowOfAnUnknownNameIsNotFound(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	if _, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "ghost"}); callCode(err) != rpc.CodeNotFound {
		t.Errorf("err = %v", err)
	}
}

func TestEnvSSHKeyRotateKeepsTheOldKeyUntilConfirm(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	first, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyMake})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(first.PublicKey, "ssh-ed25519 ") {
		t.Fatalf("public key %q", first.PublicKey)
	}
	rotated, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyRotate})
	if err != nil {
		t.Fatal(err)
	}
	if rotated.PublicKey != first.PublicKey || rotated.NewPublicKey == "" || rotated.NewPublicKey == first.PublicKey {
		t.Errorf("rotate %q / %q", rotated.PublicKey, rotated.NewPublicKey)
	}
	shown, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || shown.PublicKey != first.PublicKey {
		t.Errorf("show before confirm %q, %v", shown.PublicKey, err)
	}
	confirmed, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyConfirm})
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.PublicKey != rotated.NewPublicKey {
		t.Errorf("confirm %q, want %q", confirmed.PublicKey, rotated.NewPublicKey)
	}
}

func TestEnvMethodsWithoutAStoreAreUnavailable(t *testing.T) {
	_, sock := start(t, &memStore{})
	c := dial(t, sock)
	if _, err := envCall(c, rpc.MethodEnvList, struct{}{}); callCode(err) != rpc.CodeUnavailable {
		t.Errorf("err = %v", err)
	}
}

func TestEnvShowReturnsTheGitIdentityAndSetChangesIt(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	got, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if err != nil || got.GitName != "Bot" || got.GitEmail != "bot@example.com" {
		t.Fatalf("show %+v, %v", got, err)
	}
	if _, err := envCall(c, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", GitName: "TEST Other", GitEmail: "other@example.com"}); err != nil {
		t.Fatal(err)
	}
	got, _ = envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if got.GitName != "TEST Other" || got.GitEmail != "other@example.com" {
		t.Errorf("after set %+v", got)
	}
}

func TestEnvShowKeepsThePendingKeyAndCancelDeletesIt(t *testing.T) {
	c, _, _ := envDaemon(t, globalMates)
	createBot(t, c)
	first, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyMake})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := time.Parse(time.RFC3339, first.KeyCreated); err != nil {
		t.Errorf("key_created %q", first.KeyCreated)
	}
	rotated, _ := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyRotate})
	shown, _ := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if shown.NewPublicKey == "" || shown.NewPublicKey != rotated.NewPublicKey {
		t.Fatalf("show after rotate %q, want %q", shown.NewPublicKey, rotated.NewPublicKey)
	}
	cancelled, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyCancel})
	if err != nil || cancelled.NewPublicKey != "" || cancelled.PublicKey != first.PublicKey {
		t.Fatalf("cancel %+v, %v", cancelled, err)
	}
	if _, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyConfirm}); err == nil {
		t.Error("confirm after cancel succeeded")
	}
	if _, err := envCall(c, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyCancel}); err == nil {
		t.Error("cancel with no new key succeeded")
	}
}

type countingProbe struct {
	mu    sync.Mutex
	calls int
	facts app.LocalFacts
}

func (p *countingProbe) Local() app.LocalFacts {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	return p.facts
}

func TestEnvShowOfLocalReportsTheFactsOfThisMachineAndCachesThem(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(globalMates), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := &countingProbe{facts: app.LocalFacts{GitName: "TEST Owner", GitEmail: "owner@example.com", SSHAgent: true, SSHKeys: 2, GitHub: true, GitHubUser: "owner", Claude: true, Codex: true}}
	_, sock := start(t, &memStore{}, daemon.WithConfig(path), daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithLocalProbe(probe))
	c := dial(t, sock)
	got, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "local"})
	if err != nil || got.Local == nil {
		t.Fatalf("show local %+v, %v", got, err)
	}
	want := rpc.EnvLocal{GitName: "TEST Owner", GitEmail: "owner@example.com", SSHAgent: true, SSHKeys: 2, GitHub: true, GitHubUser: "owner", Claude: true, Codex: true}
	if *got.Local != want {
		t.Errorf("local %+v, want %+v", *got.Local, want)
	}
	if _, err := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "local"}); err != nil {
		t.Fatal(err)
	}
	probe.mu.Lock()
	calls := probe.calls
	probe.mu.Unlock()
	if calls != 1 {
		t.Errorf("probe ran %d times, want 1", calls)
	}
	if _, err := envCall(c, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGit}}); err != nil {
		t.Fatal(err)
	}
	bot, _ := envCall(c, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"})
	if bot.Local != nil {
		t.Errorf("custom env has local facts %+v", bot.Local)
	}
}
