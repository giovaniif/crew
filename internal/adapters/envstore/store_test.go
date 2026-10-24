package envstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/giovaniif/crew/internal/domain"
)

func newStore(t *testing.T) (Store, string) {
	t.Helper()
	home := t.TempDir()
	return Store{Home: home}, home
}

func mode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func botEnv() domain.Environment {
	return domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvGit, domain.EnvGitHub, domain.EnvClaude}}
}

func TestSaveWritesTheDefinitionAndDirs(t *testing.T) {
	s, home := newStore(t)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("# mine\n[defaults]\nx = \"1\"\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	cfg := readFile(t, filepath.Join(home, "config.toml"))
	if !strings.HasPrefix(cfg, "# mine\n") || !strings.Contains(cfg, "[[identity]]\nid = \"test-bot\"") {
		t.Fatalf("config:\n%s", cfg)
	}
	if mode(t, filepath.Join(home, "config.toml")) != 0o640 {
		t.Error("config mode changed")
	}
	baks, _ := filepath.Glob(filepath.Join(home, "config.toml.crew-*.bak"))
	if len(baks) != 1 {
		t.Errorf("want one backup, got %v", baks)
	}
	for _, dir := range []string{"identities/test-bot", "identities/test-bot/gh", "identities/test-bot/claude", "secrets/identity/test-bot"} {
		if mode(t, filepath.Join(home, dir)) != 0o700 {
			t.Errorf("%s is not 700", dir)
		}
	}
	got, err := s.Get("test-bot")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != domain.EnvCustom || len(got.Parts) != 3 || got.Home != filepath.Join(home, "identities", "test-bot") || got.Secrets != filepath.Join(home, "secrets", "identity", "test-bot") {
		t.Fatalf("got %+v", got)
	}
}

func TestSaveRefusesAKindChangeAndAnInvalidEnv(t *testing.T) {
	s, _ := newStore(t)
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	local := domain.Environment{Name: "test-bot", Kind: domain.EnvLocal}
	if err := s.Save(local); err == nil || !strings.Contains(err.Error(), "kind") {
		t.Fatalf("kind change: %v", err)
	}
	if err := s.Save(domain.Environment{Name: "Bad", Kind: domain.EnvCustom}); err == nil {
		t.Fatal("invalid name saved")
	}
}

func TestSecretsAreFilesAndNeverInConfig(t *testing.T) {
	s, home := newStore(t)
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSecret("test-bot", "GH_TOKEN", "TEST-gh-token"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSecret("test-bot", "LINEAR_API_KEY", "TEST-lin"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "secrets", "identity", "test-bot", "GH_TOKEN")
	if mode(t, file) != 0o600 {
		t.Error("secret is not 600")
	}
	if strings.Contains(readFile(t, filepath.Join(home, "config.toml")), "TEST-") {
		t.Fatal("a value is in config.toml")
	}
	env, _ := s.Get("test-bot")
	if strings.Join(env.Extra, ",") != "LINEAR_API_KEY" {
		t.Errorf("extra name not recorded: %v", env.Extra)
	}
	values, err := s.Secrets("test-bot")
	if err != nil || values["GH_TOKEN"] != "TEST-gh-token" || values["LINEAR_API_KEY"] != "TEST-lin" {
		t.Fatalf("values %v err %v", values, err)
	}
	set := s.SecretsSet("test-bot")
	if !set["GH_TOKEN"] || set["CLAUDE_CODE_OAUTH_TOKEN"] {
		t.Errorf("set %v", set)
	}
	for _, bad := range []string{"PATH", "OPENAI_API_KEY", "../x"} {
		if err := s.SetSecret("test-bot", bad, "TEST-x"); err == nil {
			t.Errorf("%s accepted", bad)
		} else if strings.Contains(err.Error(), "TEST-x") {
			t.Errorf("error holds the value: %v", err)
		}
	}
	if err := s.ClearSecret("test-bot", "GH_TOKEN"); err != nil {
		t.Fatal(err)
	}
	if s.SecretsSet("test-bot")["GH_TOKEN"] {
		t.Error("cleared secret still set")
	}
}

func TestGitConfigHasOnlyTheIdentity(t *testing.T) {
	s, home := newStore(t)
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteGitConfig("test-bot", "Test Bot", "bot@example.com"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "identities", "test-bot", "gitconfig")
	want := "[user]\n\tname = \"Test Bot\"\n\temail = \"bot@example.com\"\n"
	if got := readFile(t, path); got != want {
		t.Fatalf("got %q", got)
	}
	if mode(t, path) != 0o600 {
		t.Error("gitconfig is not 600")
	}
	if err := s.WriteGitConfig("test-bot", "x\n[credential]", "a@b"); err == nil {
		t.Fatal("new line accepted")
	}
}

func TestSSHKeyIsMadeOnceAndRotatedOnConfirm(t *testing.T) {
	s, home := newStore(t)
	if err := s.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvSSH}}); err != nil {
		t.Fatal(err)
	}
	pub, err := s.MakeSSHKey("test-bot")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(pub, "ssh-ed25519 ") {
		t.Fatalf("pub %q", pub)
	}
	key := filepath.Join(home, "secrets", "identity", "test-bot", "ssh", "id_ed25519")
	if mode(t, key) != 0o600 || mode(t, filepath.Dir(key)) != 0o700 {
		t.Error("key modes")
	}
	again, err := s.MakeSSHKey("test-bot")
	if err != nil || again != pub {
		t.Fatalf("second make gave a new key: %v", err)
	}
	if got, _ := s.PublicKey("test-bot"); got != pub {
		t.Fatal("PublicKey differs")
	}
	next, err := s.RotateSSHKey("test-bot")
	if err != nil || next == pub {
		t.Fatalf("rotate: %v", err)
	}
	if got, _ := s.PublicKey("test-bot"); got != pub {
		t.Fatal("old key gone before confirm")
	}
	if err := s.ConfirmSSHKey("test-bot"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.PublicKey("test-bot"); got != next {
		t.Fatal("new key not in use after confirm")
	}
	if err := s.ConfirmSSHKey("test-bot"); err == nil {
		t.Fatal("confirm with no new key")
	}
}

func TestImportSSHKey(t *testing.T) {
	s, _ := newStore(t)
	other, _ := newStore(t)
	for _, st := range []Store{s, other} {
		if err := st.Save(domain.Environment{Name: "test-bot", Kind: domain.EnvCustom, Parts: []domain.EnvPart{domain.EnvSSH}}); err != nil {
			t.Fatal(err)
		}
	}
	pub, err := other.MakeSSHKey("test-bot")
	if err != nil {
		t.Fatal(err)
	}
	private, err := os.ReadFile(filepath.Join(other.Home, "secrets", "identity", "test-bot", "ssh", "id_ed25519"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.ImportSSHKey("test-bot", private)
	if err != nil || got != pub {
		t.Fatalf("import: %q %v", got, err)
	}
	if _, err := s.ImportSSHKey("test-bot", []byte("not a key")); err == nil {
		t.Fatal("bad key imported")
	}
	if got, _ := s.PublicKey("test-bot"); got != pub {
		t.Fatal("bad import replaced the key")
	}
}

func TestDeleteRemovesAllAndRefusesWhileAMateUsesIt(t *testing.T) {
	s, home := newStore(t)
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSecret("test-bot", "GH_TOKEN", "TEST-gh"); err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(home, "config.toml")
	src := readFile(t, cfg)
	withMate := src + "\n[[mate]]\nname = \"test-mate\"\nprompt = \"p\"\nagent = \"claude\"\nenv = \"test-bot\"\n"
	if err := os.WriteFile(cfg, []byte(withMate), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("test-bot"); err == nil || !strings.Contains(err.Error(), "test-mate") {
		t.Fatalf("delete while used: %v", err)
	}
	if err := os.WriteFile(cfg, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("test-bot"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(readFile(t, cfg), "[[identity]]") {
		t.Error("definition stays")
	}
	for _, dir := range []string{"identities/test-bot", "secrets/identity/test-bot"} {
		if _, err := os.Stat(filepath.Join(home, dir)); !os.IsNotExist(err) {
			t.Errorf("%s stays", dir)
		}
	}
	if _, err := s.Get("test-bot"); err == nil {
		t.Fatal("get after delete")
	}
	if err := s.Delete("test-bot"); err == nil {
		t.Fatal("delete of unknown env")
	}
}

func TestListAndLocal(t *testing.T) {
	s, _ := newStore(t)
	list, err := s.List()
	if err != nil || len(list) != 0 {
		t.Fatalf("empty list: %v %v", list, err)
	}
	if err := s.Save(domain.Environment{Name: "work", Kind: domain.EnvLocal}); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(botEnv()); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List()
	if len(list) != 2 || list[0].Name != "work" || list[1].Name != "test-bot" {
		t.Fatalf("list %+v", list)
	}
	got, err := s.Get("")
	if err != nil || got.Kind != domain.EnvLocal || got.Name != domain.IdentityYours {
		t.Fatalf("empty name is the local env: %+v %v", got, err)
	}
}

func TestAnOldEnvTableStillReadsWithItsOldDirs(t *testing.T) {
	s, home := newStore(t)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("[[env]]\nname = \"old\"\nkind = \"custom\"\nparts = [\"github\"]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get("old")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != domain.EnvCustom || got.Home != filepath.Join(home, "envs", "old") || got.Secrets != filepath.Join(home, "secrets", "env", "old") {
		t.Fatalf("got %+v", got)
	}
}

func TestYoursAndLocalNameTheYoursIdentity(t *testing.T) {
	s, home := newStore(t)
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("[[identity]]\nid = \"yours\"\nname = \"Your accounts\"\nkind = \"yours\"\nextra = [\"TEST_A\"]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", "local", "yours"} {
		got, err := s.Get(name)
		if err != nil || got.Name != domain.IdentityYours || got.Kind != domain.EnvLocal || len(got.Extra) != 1 || got.Label != "Your accounts" {
			t.Fatalf("%q: %+v %v", name, got, err)
		}
	}
}
