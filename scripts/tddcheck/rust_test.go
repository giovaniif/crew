package tddcheck

import (
	"strings"
	"testing"
)

const fakeCargo = `#!/bin/sh
echo "fake-cargo $1"
t="tests/$1.rs"
[ -f "$t" ] || exit 1
line=$(sed -n 's/^expect //p' "$t")
file=${line%% *}
want=${line#* }
grep -qF "$want" "$file" || exit 1
`

var rustEnv = []string{"TDD_RUST_TEST=sh fake-cargo"}

func rustProject(value string) map[string]string {
	return map[string]string{
		"desktop/src-tauri/Cargo.toml":   "[package]\nname = \"app\"\n",
		"desktop/src-tauri/fake-cargo":   fakeCargo,
		"desktop/src-tauri/src/lib.rs":   rustSrc(value),
		"desktop/src-tauri/tests/ipc.rs": rustTest(value),
	}
}

func rustSrc(value string) string {
	return "pub const A: &str = \"" + value + "\";\n"
}

func rustTest(value string) string {
	return "expect src/lib.rs \"" + value + "\"\n"
}

func TestOrderedRustPRPasses(t *testing.T) {
	r := newRepo(t, rustProject("a"))
	r.commit("test(desktop): a is b", map[string]string{"desktop/src-tauri/tests/ipc.rs": rustTest("b")})
	r.commit("feat(desktop): a is b", map[string]string{"desktop/src-tauri/src/lib.rs": rustSrc("b")})
	code, out := r.check(rustEnv...)
	if code != 0 || !strings.Contains(out, "cargo test ipc on base") {
		t.Fatalf("exit %d, want 0 after running ipc on base\n%s", code, out)
	}
}

func TestRustAndWebTestsInOneCommitAreAllTests(t *testing.T) {
	files := rustProject("a")
	for k, v := range webProject("a") {
		files[k] = v
	}
	r := newRepo(t, files)
	r.commit("test: a is b", map[string]string{
		"desktop/src-tauri/tests/ipc.rs": rustTest("b"),
		"web/src/a.test.ts":              webTest("b"),
	})
	r.commit("feat: a is b", map[string]string{
		"desktop/src-tauri/src/lib.rs": rustSrc("b"),
		"web/src/a.ts":                 webSrc("b"),
	})
	code, out := r.check(append(rustEnv, webEnv...)...)
	if code != 0 {
		t.Fatalf("exit %d, want 0: a commit of Rust and web tests changes no production code\n%s", code, out)
	}
}

func TestRustTestThatPassesOnBaseFails(t *testing.T) {
	r := newRepo(t, rustProject("a"))
	r.commit("test(desktop): another test of a", map[string]string{"desktop/src-tauri/tests/fix.rs": rustTest("a")})
	code, out := r.check(rustEnv...)
	if code != 1 || !strings.Contains(out, "pass on the base branch") || !strings.Contains(out, "desktop/src-tauri/fix") {
		t.Fatalf("exit %d, want 1 naming fix, which passes on base\n%s", code, out)
	}
}

func TestCommitMixingRustTestAndCodeFails(t *testing.T) {
	r := newRepo(t, rustProject("a"))
	r.commit("feat(desktop): a is b", map[string]string{"desktop/src-tauri/src/lib.rs": rustSrc("b"), "desktop/src-tauri/tests/ipc.rs": rustTest("b")})
	code, out := r.check(rustEnv...)
	if code != 1 || !strings.Contains(out, "changes tests and production code together") {
		t.Fatalf("exit %d, want 1 naming the mixed commit\n%s", code, out)
	}
}

func TestRustTestsFailOnABaseWithoutTheCrate(t *testing.T) {
	r := newRepo(t, map[string]string{"p/a.go": src("a")})
	r.commit("test(desktop): a is b", map[string]string{"desktop/src-tauri/tests/ipc.rs": rustTest("b")})
	r.commit("feat(desktop): the crate", map[string]string{
		"desktop/src-tauri/Cargo.toml": "[package]\nname = \"app\"\n",
		"desktop/src-tauri/src/lib.rs": rustSrc("b"),
	})
	code, out := r.check(rustEnv...)
	if code != 0 || !strings.Contains(out, "no desktop/src-tauri/Cargo.toml on base") {
		t.Fatalf("exit %d, want 0: base has no crate, so its tests cannot pass there\n%s", code, out)
	}
}
