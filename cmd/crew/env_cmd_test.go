package main

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const cliEnvSecret = "TEST-zzclienvzz"

type fakeEnvCaller struct {
	calls []recordedCall
}

func (f *fakeEnvCaller) Call(_ context.Context, method string, params, out any) error {
	f.calls = append(f.calls, recordedCall{method, params})
	info := rpc.EnvInfo{Name: "bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGitHub},
		Secrets: []rpc.EnvSecret{{Name: "GH_TOKEN", Set: true}, {Name: "LINEAR_API_KEY"}}, PublicKey: "ssh-ed25519 AAAATEST crew-bot", UsedBy: []string{"reviewer"}}
	var v any = info
	if method == rpc.MethodEnvList {
		v = rpc.EnvList{Envs: []rpc.EnvInfo{{Name: "local", Kind: domain.EnvLocal}, info}}
	}
	data, _ := json.Marshal(v)
	return json.Unmarshal(data, out)
}

func envIOFor(out *bytes.Buffer, secret string) envIO {
	return envIO{
		Out:        out,
		ReadSecret: func(string) (string, error) { return secret, nil },
		ReadAll:    func() ([]byte, error) { return []byte("-----BEGIN TEST KEY-----\n"), nil },
	}
}

func TestEnvCommandsCallTheDaemon(t *testing.T) {
	parts := []domain.EnvPart{domain.EnvGit, domain.EnvGitHub}
	for _, c := range []struct {
		args   []string
		method string
		params any
		says   string
	}{
		{[]string{"list"}, rpc.MethodEnvList, struct{}{}, "bot"},
		{[]string{"show", "bot"}, rpc.MethodEnvShow, rpc.EnvNameParams{Name: "bot"}, "GH_TOKEN"},
		{[]string{"create", "bot", "--part", "git", "--part", "github", "--git-name", "Bot", "--git-email", "bot@example.com"}, rpc.MethodEnvCreate,
			rpc.EnvCreateParams{Name: "bot", Kind: domain.EnvCustom, Parts: parts, GitName: "Bot", GitEmail: "bot@example.com"}, "created bot"},
		{[]string{"create", "work", "--kind", "local"}, rpc.MethodEnvCreate, rpc.EnvCreateParams{Name: "work", Kind: domain.EnvLocal}, "created work"},
		{[]string{"set", "bot", "GH_TOKEN"}, rpc.MethodEnvSet, rpc.EnvSetParams{Name: "bot", Secret: "GH_TOKEN", Value: cliEnvSecret}, "next start or resume"},
		{[]string{"unset", "bot", "GH_TOKEN"}, rpc.MethodEnvUnset, rpc.EnvUnsetParams{Name: "bot", Secret: "GH_TOKEN"}, "next start or resume"},
		{[]string{"delete", "bot"}, rpc.MethodEnvDelete, rpc.EnvNameParams{Name: "bot"}, "deleted bot"},
		{[]string{"ssh-key", "bot"}, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot"}, "ssh-ed25519 AAAATEST"},
		{[]string{"ssh-key", "bot", "--rotate"}, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyRotate}, "ssh-ed25519"},
		{[]string{"ssh-key", "bot", "--import"}, rpc.MethodEnvSSHKey, rpc.EnvSSHKeyParams{Name: "bot", Action: rpc.EnvSSHKeyImport, PrivateKey: "-----BEGIN TEST KEY-----\n"}, "ssh-ed25519"},
	} {
		f := &fakeEnvCaller{}
		var out bytes.Buffer
		if err := envCommand(context.Background(), f, envIOFor(&out, cliEnvSecret), c.args); err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		if len(f.calls) != 1 || f.calls[0].method != c.method || !reflect.DeepEqual(f.calls[0].params, c.params) {
			t.Fatalf("%v: calls %+v", c.args, f.calls)
		}
		if !strings.Contains(out.String(), c.says) {
			t.Fatalf("%v: output %q", c.args, out.String())
		}
		if strings.Contains(out.String(), "zzclienvzz") {
			t.Fatalf("%v: output holds the secret: %q", c.args, out.String())
		}
	}
}

func TestEnvShowPrintsSetOrNotSetAndNoValue(t *testing.T) {
	var out bytes.Buffer
	if err := envCommand(context.Background(), &fakeEnvCaller{}, envIOFor(&out, ""), []string{"show", "bot"}); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, want := range []string{"GH_TOKEN", "set", "LINEAR_API_KEY", "not set", "reviewer", "custom"} {
		if !strings.Contains(text, want) {
			t.Errorf("show lacks %q:\n%s", want, text)
		}
	}
}

func TestEnvSetRefusesAValueInArgv(t *testing.T) {
	for _, args := range [][]string{{"set", "bot", "GH_TOKEN", cliEnvSecret}, {"set", "bot", "GH_TOKEN=" + cliEnvSecret}} {
		f := &fakeEnvCaller{}
		var out bytes.Buffer
		err := envCommand(context.Background(), f, envIOFor(&out, cliEnvSecret), args)
		if err == nil || !strings.Contains(err.Error(), "stdin") {
			t.Errorf("%v: err = %v", args, err)
		}
		if err != nil && strings.Contains(err.Error(), "zzclienvzz") {
			t.Errorf("%v: the error shows the value", args)
		}
		if len(f.calls) != 0 {
			t.Errorf("%v: calls %+v", args, f.calls)
		}
	}
}

func TestEnvSetRefusesAnEmptyValue(t *testing.T) {
	f := &fakeEnvCaller{}
	var out bytes.Buffer
	if err := envCommand(context.Background(), f, envIOFor(&out, ""), []string{"set", "bot", "GH_TOKEN"}); err == nil || len(f.calls) != 0 {
		t.Errorf("err = %v, calls %+v", err, f.calls)
	}
}

func TestRunEnvRejectsBadArgumentsAndHelp(t *testing.T) {
	for _, args := range [][]string{nil, {"bogus"}, {"show"}, {"show", "--help"}, {"delete", "-h"}, {"list", "x"}, {"unset", "bot"}, {"create", "--help"}, {"login"}, {"ssh-key", "bot", "--bogus"}} {
		var out, errOut bytes.Buffer
		if code := runEnv(args, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "usage: crew env") {
			t.Errorf("%v: code %d, stderr %q", args, code, errOut.String())
		}
	}
}

func TestEnvLoginRunsTheHarnessLoginInsideTheEnvironment(t *testing.T) {
	if got := envLoginArgv("bot"); !reflect.DeepEqual(got, []string{"exec", "bot", "--harness", "claude", "--", "claude", "setup-token"}) {
		t.Errorf("argv %v", got)
	}
}

func TestMateSetTakesAnEnvironment(t *testing.T) {
	m, err := mateFromFlags(domain.Mate{Name: "reviewer", Env: "old"}, []string{"--env", "bot"})
	if err != nil || m.Env != "bot" {
		t.Errorf("mate %+v, %v", m, err)
	}
	m, err = mateFromFlags(domain.Mate{Name: "reviewer", Env: "old"}, []string{"--prompt", "hi"})
	if err != nil || m.Env != "old" {
		t.Errorf("mate %+v, %v", m, err)
	}
}

func TestMateSetSaysAnEnvironmentChangeAppliesAtTheNextStart(t *testing.T) {
	var out bytes.Buffer
	reportMateSaved(&out, domain.Mate{Name: "reviewer", Env: "bot"}, true)
	if !strings.Contains(out.String(), "next start or resume") {
		t.Errorf("output %q", out.String())
	}
}
