package daemon_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const copySecret = "TEST-zzcopysecretzz"

func copyDaemon(t *testing.T) (*rpc.Client, string) {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte(globalMates), 0o600); err != nil {
		t.Fatal(err)
	}
	_, sock := start(t, &memStore{}, daemon.WithConfig(path), daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithMachine("devbox"))
	return dial(t, sock), home
}

func callRaw(t *testing.T, c *rpc.Client, method string, params any, out any) []byte {
	t.Helper()
	var raw json.RawMessage
	if err := c.Call(context.Background(), method, params, &raw); err != nil {
		t.Fatalf("%s: %v", method, err)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatal(err)
		}
	}
	return raw
}

func TestIdentityCopyMovesTheSecretsInASealedBundleAndMakesANewSSHKey(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	source, sourceHome := copyDaemon(t)
	target, targetHome := copyDaemon(t)
	var answers [][]byte
	answers = append(answers, callRaw(t, source, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGit, domain.EnvSSH, domain.EnvGitHub}, GitName: "TEST Bot", GitEmail: "bot@example.com"}, nil))
	answers = append(answers, callRaw(t, source, rpc.MethodIdentitySetSecret, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: copySecret}, nil))
	answers = append(answers, callRaw(t, source, rpc.MethodIdentitySetSecret, rpc.EnvSetParams{Name: "bot", Secret: "TEST_EXTRA", Value: copySecret + "-x"}, nil))
	var sourceInfo rpc.EnvInfo
	answers = append(answers, callRaw(t, source, rpc.MethodIdentitySSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyMake}, &sourceInfo))

	var begin rpc.IdentityCopyBegin
	answers = append(answers, callRaw(t, target, rpc.MethodIdentityCopyBegin, struct{}{}, &begin))
	var export rpc.IdentityExport
	answers = append(answers, callRaw(t, source, rpc.MethodIdentityExport, rpc.IdentityExportParams{Name: "bot", PublicKey: begin.PublicKey}, &export))
	var got rpc.EnvInfo
	answers = append(answers, callRaw(t, target, rpc.MethodIdentityImport, rpc.IdentityImportParams{CopyID: begin.CopyID, Bundle: export.Bundle}, &got))

	if got.Name != "bot" || got.GitName != "TEST Bot" || got.GitEmail != "bot@example.com" {
		t.Fatalf("imported %+v", got)
	}
	for _, name := range []string{"GH_TOKEN", "TEST_EXTRA"} {
		if set, _ := secretSet(got, name); !set {
			t.Errorf("%s is not set: %+v", name, got.Secrets)
		}
	}
	if got.PublicKey == "" || got.PublicKey == sourceInfo.PublicKey {
		t.Errorf("the target has no new SSH key: %q", got.PublicKey)
	}
	secret, err := os.ReadFile(filepath.Join(targetHome, "secrets", "identity", "bot", "GH_TOKEN"))
	if err != nil || string(secret) != copySecret {
		t.Fatalf("target GH_TOKEN %q %v", secret, err)
	}
	sourceKey, _ := os.ReadFile(filepath.Join(sourceHome, "secrets", "identity", "bot", "ssh", "id_ed25519"))
	targetKey, _ := os.ReadFile(filepath.Join(targetHome, "secrets", "identity", "bot", "ssh", "id_ed25519"))
	if len(sourceKey) == 0 || bytes.Equal(sourceKey, targetKey) {
		t.Fatal("the SSH private key went to the target")
	}
	for _, a := range answers {
		if strings.Contains(string(a), "zzcopysecretzz") {
			t.Fatalf("an answer holds a secret: %s", a)
		}
	}
	if strings.Contains(logs.String(), "zzcopysecretzz") {
		t.Fatalf("the log holds a secret:\n%s", logs.String())
	}

	var rerr *rpc.Error
	err = target.Call(context.Background(), rpc.MethodIdentityImport, rpc.IdentityImportParams{CopyID: begin.CopyID, Bundle: export.Bundle}, nil)
	if !errors.As(err, &rerr) || strings.Contains(err.Error(), "zzcopysecretzz") {
		t.Fatalf("a used copy_id: %v", err)
	}
}

func TestIdentityImportRefusesABundleForADifferentKeyAndAnUnknownCopyID(t *testing.T) {
	source, _ := copyDaemon(t)
	target, _ := copyDaemon(t)
	callRaw(t, source, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub}}, nil)
	var first, second rpc.IdentityCopyBegin
	callRaw(t, target, rpc.MethodIdentityCopyBegin, struct{}{}, &first)
	callRaw(t, target, rpc.MethodIdentityCopyBegin, struct{}{}, &second)
	var export rpc.IdentityExport
	callRaw(t, source, rpc.MethodIdentityExport, rpc.IdentityExportParams{Name: "bot", PublicKey: first.PublicKey}, &export)
	if err := target.Call(context.Background(), rpc.MethodIdentityImport, rpc.IdentityImportParams{CopyID: second.CopyID, Bundle: export.Bundle}, nil); err == nil {
		t.Fatal("a bundle for a different key opened")
	}
	if err := target.Call(context.Background(), rpc.MethodIdentityImport, rpc.IdentityImportParams{CopyID: "nope", Bundle: export.Bundle}, nil); err == nil {
		t.Fatal("an unknown copy_id worked")
	}
}

func TestIdentityImportOfANameInUseGetsANumberedName(t *testing.T) {
	source, _ := copyDaemon(t)
	target, _ := copyDaemon(t)
	callRaw(t, source, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "work-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub}}, nil)
	callRaw(t, target, rpc.MethodIdentitySet, rpc.EnvCreateParams{Name: "work-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub}}, nil)
	var begin rpc.IdentityCopyBegin
	callRaw(t, target, rpc.MethodIdentityCopyBegin, struct{}{}, &begin)
	var export rpc.IdentityExport
	callRaw(t, source, rpc.MethodIdentityExport, rpc.IdentityExportParams{Name: "work-bot", PublicKey: begin.PublicKey}, &export)
	var got rpc.EnvInfo
	callRaw(t, target, rpc.MethodIdentityImport, rpc.IdentityImportParams{CopyID: begin.CopyID, Bundle: export.Bundle}, &got)
	if got.Name != "work-bot-2" {
		t.Fatalf("imported as %q, want work-bot-2", got.Name)
	}
}

func TestIdentityExportRefusesYours(t *testing.T) {
	source, _ := copyDaemon(t)
	target, _ := copyDaemon(t)
	var begin rpc.IdentityCopyBegin
	callRaw(t, target, rpc.MethodIdentityCopyBegin, struct{}{}, &begin)
	if err := source.Call(context.Background(), rpc.MethodIdentityExport, rpc.IdentityExportParams{Name: domain.IdentityYours, PublicKey: begin.PublicKey}, nil); err == nil {
		t.Fatal("yours was exported")
	}
}
