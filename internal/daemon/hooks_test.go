package daemon_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/adapters/envstore"
	"github.com/giovaniif/crew/internal/daemon"
	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func TestMissingHooksAreCheckedAtStartShownAndFixed(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, []byte("[[env]]\nname = \"work\"\nkind = \"custom\"\nparts = [\"claude\"]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	local := domain.HooksMissing{Env: "local", Harness: domain.HarnessClaude, File: "/h/.claude/settings.json", Reason: "crew hooks are missing in ~/.claude/settings.json"}
	work := domain.HooksMissing{Env: "work", Harness: domain.HarnessClaude, File: "/e/work/claude/settings.json", Reason: "crew hooks are missing in /e/work/claude/settings.json"}
	f := &fakeHooks{missing: []domain.HooksMissing{local, work}}
	_, sock := start(t, &memStore{}, daemon.WithConfig(path), daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithHooksChecker(f))
	c := dial(t, sock)
	ctx := context.Background()

	var st rpc.Status
	deadline := time.Now().Add(5 * time.Second)
	for len(st.HooksMissing) == 0 && time.Now().Before(deadline) {
		var err error
		if st, err = c.Status(ctx); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !reflect.DeepEqual(st.HooksMissing, []domain.HooksMissing{local, work}) {
		t.Fatalf("status hooks = %+v", st.HooksMissing)
	}
	f.mu.Lock()
	envs := f.envs
	f.mu.Unlock()
	if !reflect.DeepEqual(envs, []string{"work"}) {
		t.Errorf("checked envs = %v, want the custom env work", envs)
	}

	var list rpc.EnvList
	if err := c.Call(ctx, rpc.MethodEnvList, nil, &list); err != nil {
		t.Fatal(err)
	}
	for _, e := range list.Envs {
		want := map[string][]domain.HooksMissing{"local": {local}, "work": {work}}[e.Name]
		if !reflect.DeepEqual(e.HooksMissing, want) {
			t.Errorf("env %s hooks = %+v, want %+v", e.Name, e.HooksMissing, want)
		}
	}

	got, err := c.FixHooks(ctx, "work", domain.HarnessClaude)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Missing, []domain.HooksMissing{local}) {
		t.Errorf("after fix = %+v, want local only", got.Missing)
	}
	if st, _ := c.Status(ctx); !reflect.DeepEqual(st.HooksMissing, []domain.HooksMissing{local}) {
		t.Errorf("status after fix = %+v", st.HooksMissing)
	}
	if now, err := c.Hooks(ctx); err != nil || !reflect.DeepEqual(now.Missing, []domain.HooksMissing{local}) {
		t.Errorf("hooks.status = %+v, %v", now, err)
	}
}

func TestFixHooksRefusesABadHarnessOrAnUnknownEnvironment(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "config.toml")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	f := &fakeHooks{}
	_, sock := start(t, &memStore{}, daemon.WithConfig(path), daemon.WithEnvironments(envstore.Store{Home: home}), daemon.WithHooksChecker(f))
	c := dial(t, sock)
	var rerr *rpc.Error
	if _, err := c.FixHooks(context.Background(), "local", "vim"); !errors.As(err, &rerr) || rerr.Code != rpc.CodeBadRequest {
		t.Errorf("bad harness: %v", err)
	}
	if _, err := c.FixHooks(context.Background(), "nope", domain.HarnessClaude); !errors.As(err, &rerr) || rerr.Code != rpc.CodeNotFound {
		t.Errorf("unknown env: %v", err)
	}
	if len(f.fixed) != 0 {
		t.Errorf("fixed = %v", f.fixed)
	}
}
