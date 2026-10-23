package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const guiPath = "/usr/bin:/bin"

var appTools = []struct{ name, hint string }{
	{"cargo", "install Rust from rustup.rs"},
	{"npm", "install Node 22.18 or newer"},
	{"tauri-driver", "cargo install tauri-driver --locked"},
	{"WebKitWebDriver", "sudo apt-get install -y webkit2gtk-driver"},
}

func appTarget(e *env) string {
	if d := e.sys.getenv("VERIFY_CARGO_TARGET"); d != "" {
		return d
	}
	return "/tmp/crew-verify-cargo"
}

func appEnv(st isoState) []string {
	var vars []string
	for _, kv := range st.Env {
		if !strings.HasPrefix(kv, "PATH=") {
			vars = append(vars, kv)
		}
	}
	return append(vars, "PATH="+guiPath, "CREW_NO_UPDATE_CHECK=1")
}

func app(e *env, args []string, r *result) {
	if len(args) == 0 {
		r.bad("app needs shot or drive", "go run ./scripts/verify app shot /")
		return
	}
	o, ok := parse(args[1:], []string{"steps", "out-dir"}, nil, r)
	if !ok {
		return
	}
	if len(o.pos) != 1 || !strings.HasPrefix(o.pos[0], "/") {
		r.bad("app "+args[0]+" needs one route that starts with /", "go run ./scripts/verify app "+args[0]+" /")
		return
	}
	route := o.pos[0]
	g, _ := json.Marshal(route)
	steps := []map[string]json.RawMessage{{"goto": g}}
	switch args[0] {
	case "shot":
		steps = append(steps, map[string]json.RawMessage{"shot": json.RawMessage(`"shot.png"`)})
	case "drive":
		more, err := parseWebSteps(o.get("steps", ""))
		if err != nil {
			r.bad(err.Error(), `--steps '[{"click":{"role":"tab","name":"Terminal"}},{"shot":"after.png"}]'`)
			return
		}
		steps = append(steps, more...)
	default:
		r.bad("unknown app command "+args[0], "use shot or drive")
		return
	}
	st, ok := needIso(e, r)
	if !ok {
		return
	}
	paths := map[string]string{}
	for _, t := range appTools {
		p, found := e.sys.look(t.name)
		if !found {
			r.fail(t.name+" is not on PATH", t.hint)
			continue
		}
		paths[t.name] = p
	}
	if len(r.problems) > 0 {
		return
	}
	dir, err := outDir(e, o, "app")
	if err != nil {
		r.fail(err.Error(), "check the --out-dir")
		return
	}
	target := appTarget(e)
	debug := filepath.Join(target, "debug")
	if out, errs, code := e.sys.exec(cmd{dir: filepath.Join(e.repo, "web"), name: "npm", args: []string{"run", "build"}}); code != 0 {
		r.fail("the web app does not build: "+firstLine(out+errs, "error"), "cd web && npm ci")
		return
	}
	if out, errs, code := e.sys.exec(cmd{dir: e.repo, name: "go", args: []string{"build", "-o", filepath.Join(debug, "crew"), "./cmd/crew"}}); code != 0 {
		r.fail("crew does not build: "+firstLine(out+errs, "error"), "run make build and fix the error")
		return
	}
	cargoEnv := append(os.Environ(), "CARGO_TARGET_DIR="+target)
	if out, errs, code := e.sys.exec(cmd{dir: e.repo, env: cargoEnv, name: paths["cargo"], args: []string{"build", "--manifest-path", filepath.Join(e.repo, "desktop", "src-tauri", "Cargo.toml")}}); code != 0 {
		r.fail("the desktop app does not build: "+firstLine(out+errs, "error"), "see desktop/AGENTS.md for the Tauri system libraries; df -h / needs about 10 GB")
		return
	}
	port, native := e.sys.freePort(), e.sys.freePort()
	vars := appEnv(st)
	argv := []string{paths["tauri-driver"], "--port", strconv.Itoa(port), "--native-port", strconv.Itoa(native)}
	if d := e.sys.getenv("DISPLAY"); d != "" {
		vars = append(vars, "DISPLAY="+d)
	} else {
		argv = append([]string{"/usr/bin/xvfb-run", "-a", "-s", "-screen 0 1440x900x24"}, argv...)
	}
	pid, err := e.sys.start(cmd{dir: st.Home, env: vars, name: argv[0], args: argv[1:]}, filepath.Join(dir, "driver.log"))
	if err != nil {
		r.fail("tauri-driver did not start: "+err.Error(), "read "+filepath.Join(dir, "driver.log"))
		return
	}
	defer e.sys.kill(pid)
	driver := "http://127.0.0.1:" + strconv.Itoa(port)
	if !waitHTTP(e, driver+"/status") {
		r.fail("tauri-driver does not answer on "+driver, "read "+filepath.Join(dir, "driver.log"))
		return
	}
	appBin := filepath.Join(debug, "crew-desktop")
	b, _ := json.Marshal(map[string]any{
		"app":       appBin,
		"driver":    driver,
		"steps":     steps,
		"out_dir":   dir,
		"settle_ms": 700,
		"width":     1440,
		"height":    900,
	})
	script := filepath.Join(e.repo, "desktop", "e2e", "verify-drive.mjs")
	out, errs, code := e.sys.exec(cmd{dir: e.repo, name: "node", args: []string{script}, stdin: string(b)})
	r.set("route", route)
	r.set("app", appBin)
	r.set("path", guiPath)
	var res driverResult
	if err := json.Unmarshal([]byte(lastJSON(out)), &res); err != nil {
		r.fail("the WebDriver runner gave no result: "+firstLine(out+errs, "Error"), "read "+filepath.Join(dir, "driver.log"))
		return
	}
	shots := []map[string]any{}
	for _, s := range res.Shots {
		shot := map[string]any{"path": s.Path, "viewport": s.Viewport}
		if sum, err := fileHash(s.Path); err == nil {
			shot["sha256"] = sum
		}
		shots = append(shots, shot)
	}
	r.set("shots", shots)
	if res.Eval != nil {
		r.set("eval", res.Eval)
	}
	if res.FailedStep != nil {
		r.set("failed_step", *res.FailedStep)
	}
	if res.Failure != "" {
		r.set("failure", res.Failure)
	}
	if res.Error != "" || code != 0 {
		msg := res.Error
		if msg == "" {
			msg = firstLine(errs, "Error")
		}
		hint := "check the step; read " + filepath.Join(dir, "driver.log")
		if res.Failure != "" {
			hint = "read the failure shot " + res.Failure
		}
		r.fail("app: "+msg, hint)
	}
}
