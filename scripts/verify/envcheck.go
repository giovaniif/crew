package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const envFake = `#!/bin/sh
d="$CREW_HOME/dumps"
mkdir -p "$d"
f="$d/$(basename "$0").$$.env"
{ env; printf 'CREW_ARGV=%s\n' "$*"; } >"$f.tmp" && mv "$f.tmp" "$f"
exec cat
`

func writeEnvFakes(home string) error {
	dir := filepath.Join(home, "fakes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, h := range []string{"claude", "codex", "omp"} {
		if err := os.WriteFile(filepath.Join(dir, h), []byte(envFake), 0o755); err != nil {
			return err
		}
	}
	return nil
}

func prependPath(vars []string, dir string) []string {
	out := append([]string{}, vars...)
	for i, kv := range out {
		if strings.HasPrefix(kv, "PATH=") {
			out[i] = "PATH=" + dir + string(os.PathListSeparator) + kv[len("PATH="):]
		}
	}
	return out
}

var personalFiles = map[string]string{
	".gitconfig":               "[user]\n\tname = TEST personal\n\temail = test-personal@invalid\n",
	".claude.json":             "{\"TEST\":\"personal claude\"}\n",
	".claude/settings.json":    "{\"TEST\":\"personal claude settings\"}\n",
	".codex/config.toml":       "TEST = \"personal codex\"\n",
	".omp/agent/settings.json": "{\"TEST\":\"personal omp\"}\n",
	".config/gh/hosts.yml":     "TEST: personal gh\n",
	".ssh/config":              "# TEST personal ssh\n",
}

var personalRoots = []string{".gitconfig", ".claude.json", ".claude", ".codex", ".omp", ".config/gh", ".ssh"}

func seedPersonalHome(h string) error {
	for f, body := range personalFiles {
		p := filepath.Join(h, f)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func personalSums(h string) map[string]string {
	sums := map[string]string{}
	for _, root := range personalRoots {
		_ = filepath.WalkDir(filepath.Join(h, root), func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			rel, _ := filepath.Rel(h, p)
			if d.IsDir() {
				sums[rel+"/"] = "dir"
				return nil
			}
			b, rerr := os.ReadFile(p)
			if rerr != nil {
				sums[rel] = "unreadable"
				return nil
			}
			s := sha256.Sum256(b)
			sums[rel] = hex.EncodeToString(s[:])
			return nil
		})
	}
	return sums
}

func isoHomesum(e *env, args []string, r *result) {
	o, ok := parse(args, []string{"save", "check"}, nil, r)
	if !ok {
		return
	}
	st, ok := needIso(e, r)
	if !ok {
		return
	}
	sums := personalSums(filepath.Join(st.Home, "home"))
	r.set("files", len(sums))
	dir := filepath.Join(st.Home, "homesums")
	if name := o.get("save", ""); name != "" {
		b, _ := json.Marshal(sums)
		err := os.MkdirAll(dir, 0o700)
		if err == nil {
			err = os.WriteFile(filepath.Join(dir, name+".json"), b, 0o600)
		}
		if err != nil {
			r.fail("cannot save the checksum: "+err.Error(), "check "+dir)
		}
		r.set("saved", name)
	}
	name := o.get("check", "")
	if name == "" {
		return
	}
	b, err := os.ReadFile(filepath.Join(dir, name+".json"))
	var before map[string]string
	if err == nil {
		err = json.Unmarshal(b, &before)
	}
	if err != nil {
		r.fail("no saved checksum "+name, "run iso homesum --save "+name+" first")
		return
	}
	var changed []string
	for k, v := range sums {
		if before[k] != v {
			changed = append(changed, k)
		}
	}
	for k := range before {
		if _, ok := sums[k]; !ok {
			changed = append(changed, k)
		}
	}
	sort.Strings(changed)
	for _, k := range changed {
		r.fail("the personal home file "+k+" changed", "a mate wrote into the personal HOME")
	}
}

func readDump(path string) map[string]string {
	m := map[string]string{}
	b, err := os.ReadFile(path)
	if err != nil {
		return m
	}
	for _, line := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok && k != "" && !strings.ContainsAny(k, " \t") {
			m[k] = v
		}
	}
	return m
}

func newestDump(dir, harness string) string {
	matches, _ := filepath.Glob(filepath.Join(dir, harness+".*.env"))
	best, bestAt := "", time.Time{}
	for _, m := range matches {
		if info, err := os.Stat(m); err == nil && !info.ModTime().Before(bestAt) {
			best, bestAt = m, info.ModTime()
		}
	}
	return best
}

func isoDump(e *env, args []string, r *result) {
	o, ok := parse(args, []string{"has", "set", "unset", "save", "same", "ignore", "wait"}, []string{"clear"}, r)
	if !ok {
		return
	}
	st, ok := needIso(e, r)
	if !ok {
		return
	}
	dir := filepath.Join(st.Home, "dumps")
	if o.bools["clear"] {
		matches, _ := filepath.Glob(filepath.Join(dir, "*.env"))
		for _, m := range matches {
			_ = os.Remove(m)
		}
		r.set("cleared", len(matches))
		if len(o.pos) == 0 {
			return
		}
	}
	if len(o.pos) != 1 {
		r.bad("iso dump needs one harness", "go run ./scripts/verify iso dump claude --has CLAUDE_CONFIG_DIR={home}/envs/test-bot/claude")
		return
	}
	wait, err := strconv.Atoi(o.get("wait", "20"))
	if err != nil || wait < 0 {
		r.bad("--wait must be a number of seconds", "--wait 20")
		return
	}
	path := newestDump(dir, o.pos[0])
	for i := 0; path == "" && i < wait*5; i++ {
		time.Sleep(200 * time.Millisecond)
		path = newestDump(dir, o.pos[0])
	}
	if path == "" {
		r.fail("no dump of the fake "+o.pos[0]+" in "+dir, "start a mate with go run ./scripts/verify iso up --env-fakes; read "+filepath.Join(st.Home, "daemon.log"))
		return
	}
	r.set("dump", path)
	vars := readDump(path)
	expand := func(s string) string { return strings.ReplaceAll(s, "{home}", st.Home) }
	for _, kv := range o.vals["has"] {
		k, v, _ := strings.Cut(kv, "=")
		got, present := vars[k]
		if !present || got != expand(v) {
			r.fail(k+" does not have the expected value", "read the dump "+path)
		}
	}
	for _, k := range o.vals["set"] {
		if vars[k] == "" {
			r.fail(k+" is not set", "read the dump "+path)
		}
	}
	for _, k := range o.vals["unset"] {
		if _, present := vars[k]; present {
			r.fail(k+" is set", "read the dump "+path)
		}
	}
	saved := filepath.Join(dir, "saved")
	if name := o.get("same", ""); name != "" {
		before := readDump(filepath.Join(saved, name+".env"))
		if len(before) == 0 {
			r.fail("no saved dump "+name, "run iso dump <harness> --save "+name+" first")
		}
		ignore := map[string]bool{}
		for _, k := range o.vals["ignore"] {
			ignore[k] = true
		}
		var diff []string
		for k, v := range vars {
			if bv, ok := before[k]; !ignore[k] && (!ok || bv != v) {
				diff = append(diff, k)
			}
		}
		for k := range before {
			if _, ok := vars[k]; !ignore[k] && !ok {
				diff = append(diff, k)
			}
		}
		sort.Strings(diff)
		for _, k := range diff {
			r.fail("the variable "+k+" differs from the saved dump "+name, "compare "+path+" with "+filepath.Join(saved, name+".env"))
		}
	}
	if name := o.get("save", ""); name != "" {
		b, _ := os.ReadFile(path)
		if err := os.MkdirAll(saved, 0o700); err == nil {
			_ = os.WriteFile(filepath.Join(saved, name+".env"), b, 0o600)
		}
		r.set("saved", name)
	}
}

func isoLeaks(e *env, args []string, r *result) {
	o, ok := parse(args, []string{"api"}, nil, r)
	if !ok {
		return
	}
	if len(o.pos) != 1 || o.pos[0] == "" {
		r.bad("iso leaks needs one text", "go run ./scripts/verify iso leaks sk-ant-oat01-TEST --api /api/v1/envs")
		return
	}
	text := o.pos[0]
	st, ok := needIso(e, r)
	if !ok {
		return
	}
	var checked []string
	out, _, _ := e.sys.exec(cmd{name: "ps", args: []string{"-eo", "args"}})
	checked = append(checked, "ps")
	if psHas(out, text) {
		r.fail("ps shows the text", "a secret is in the arguments of a process")
	}
	logs, _ := filepath.Glob(filepath.Join(st.Home, "*.log"))
	for _, l := range logs {
		checked = append(checked, filepath.Base(l))
		if b, err := os.ReadFile(l); err == nil && strings.Contains(string(b), text) {
			r.fail(filepath.Base(l)+" has the text", "a secret is in a log")
		}
	}
	for _, p := range o.vals["api"] {
		checked = append(checked, p)
		body, errs, code := e.sys.exec(cmd{name: "curl", args: []string{"-sS", "-H", "Authorization: Bearer " + st.Token, st.ServeURL + p}})
		if code != 0 {
			r.fail("GET "+p+" failed: "+strings.TrimSpace(errs), "read "+filepath.Join(st.Home, "serve.log"))
			continue
		}
		if strings.Contains(body, text) {
			r.fail("the serve answer of "+p+" has the text", "a secret is in a serve answer")
		}
	}
	r.set("checked", checked)
}

func isoPanes(e *env, args []string, r *result) {
	o, ok := parse(args, []string{"expect"}, nil, r)
	if !ok {
		return
	}
	st, ok := needIso(e, r)
	if !ok {
		return
	}
	out, errs, code := e.sys.exec(cmd{name: "tmux", args: []string{"-L", st.Socket, "list-panes", "-a", "-F", "#{pane_start_command}"}})
	if code != 0 {
		r.fail("tmux list-panes failed: "+strings.TrimSpace(errs), "is the isolated crew up?")
		return
	}
	r.set("panes", strings.Split(strings.TrimSpace(out), "\n"))
	for _, want := range o.vals["expect"] {
		if !strings.Contains(out, want) {
			r.fail("no pane starts with "+strconv.Quote(want), "read panes in the result")
		}
	}
}

func psHas(out, text string) bool {
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, text) && !strings.Contains(line, "iso leaks ") {
			return true
		}
	}
	return false
}
