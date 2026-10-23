# scripts

Repo tooling. The repo-wide rules are in the [root AGENTS.md](../AGENTS.md).

- **`lint-comments [dir...]`** (`make lint`): fails on any comment in these files:
  - Go, shell (`.sh` or a shell shebang), Makefiles, YAML, Lua and SQL.
  - `.txtar` scripts (only the script part, before the first `-- file --`).
  - TypeScript and JavaScript (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), and CSS.
  - Swift (`//`, `///` and nested `/* */`). It skips multi-line `"""` strings.

  Only tool directives pass. In TypeScript, that is a triple-slash `/// <reference ...>`. In Swift, it is the `// swift-tools-version:` line. It does not parse JSX text. Thus, to put a `//` in text between tags, use a string expression. It walks `.github/` but no other dot dir. It skips `vendor/`, `node_modules/`, the root `bin/`, every `dist/` (thus the built app in `internal/serve/dist`), every `target/` and `build/` (thus the desktop and Android build output), and Go files under `testdata/`. See [ADR 0044](../docs/adr/0044-no-comments.md). Its fixtures are in its `testdata/` as `*.<ext>.txt`, so that no other tool reads them.
- **`lint-agents`** (`make lint`): fails when one of these conditions is true:
  - The root `AGENTS.md` is longer than 150 lines (`-max n`).
  - A scoped `AGENTS.md` has no `CLAUDE.md` symlink to it beside it.
  - A relative link in an `AGENTS.md` or `ARCHITECTURE.md` does not resolve.

  It skips `testdata/`, `.claude/`, `.git/`, `node_modules/`, `vendor/`, `bin/` and `dist/`. Its fixtures are directory trees under its `testdata/`. See [ADR 0041](../docs/adr/0041-scoped-agents-md.md).
- **`tdd-check <base> <head>`**: the check that CI's `tdd` job runs.
  - **Files.** It covers added or changed `*_test.go` files and files under a `testdata/` dir (such as e2e `.txtar` scripts). Each file counts for the package that owns it. It runs them with `-tags integration`, so integration tests count too. It skips `fakes_test.go`/`*_fake_test.go`.
  - **Commit order.** First, it fails when a non-merge commit in `base..head` changes tests and production code together. A commit whose subject starts with `refactor:` or `refactor(` is exempt, and so are Markdown files (ADR 0043). A moved and edited test counts in both checks. The base run removes its old path and each test file that the PR deleted.
  - **Ignored changes.** It ignores a Go test change when the Go tokens of the file did not change. Thus whitespace and comments of both styles do not count, but whitespace in a string literal does. In other testdata, it ignores changes in the amount of whitespace, blank lines, and `//` and `#` comment lines. The exception is `*.golden` and `*.txt` fixtures, where comment-shaped lines are data (ADR 0045).
  - **Web tests** have parity with Go ([ADR 0048](../docs/adr/0048-web-toolchain-and-tdd-parity.md)). `web/**/*.test.ts(x)` and web `testdata/` count for the commit-order rule. On base, it runs `npm ci` in `web/`, then `npx vitest run` one time for each changed test file (or one time for the directory that owns changed web testdata). If one passes, the job fails. A base without `web/package.json` counts as failing. A failed `npm ci` fails the job. Helpers under `web/src/test/` are exempt, like port fakes. `TDD_WEB_INSTALL` and `TDD_WEB_TEST` replace the two commands. Its tests use them to run without Node.
  - **Rust tests** have the same parity. Files under `desktop/src-tauri/tests/` count as tests. On base, it runs `cargo test --test <name>` in `desktop/src-tauri/` one time for each changed `tests/<name>.rs`. Helper files in a subdirectory of `tests/` count as tests for the commit-order rule, but it does not run them. Rust unit tests in a `#[cfg(test)]` module of a `src/` file are production code, so put new Rust tests in `tests/`. A base without `desktop/src-tauri/Cargo.toml` counts as failing. `TDD_RUST_TEST` replaces `cargo test --test`. Its tests use it to run without Cargo.
  - **Its tests** are in `scripts/tddcheck`. They build temporary repos and run the script on them.
  - **Local runs.** Before you push, run it locally on a clean tree to check a branch. It refuses uncommitted changes. It resolves both refs to commits first, so `HEAD` works. On exit, pass or fail, it puts back the branch or commit that you started on, with a clean index.
- **`mutate`** (`make mutate`): runs `gremlins` on `domain` and `app`. It fails below 80% efficacy. It skips a package with no tests. On a pull request, CI's `mutate` job runs `gremlins` only on a package whose non-test files changed, and only on the changed lines (`--diff` against the base commit). A push to `main` runs the full `make mutate`. Install it with `go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0`.
- **`ci-changes`**: the `changes` job of `ci.yml` and `ios.yml`. It writes the flags `go`, `web`, `desktop`, `android` and `ios` to `GITHUB_OUTPUT` from the diff of a pull request. A push, a tag, a manual run, a change in `.github/`, in `Makefile` or in the script itself sets all flags. `desktop`, `desktop-macos`, `android` and `ios` run only when their flag is true. `build`, `tdd` and `mutate` always run, because they are required checks, but they skip their heavy steps. A docs-only change runs only `lint-comments` and `lint-agents` in `build`. When `changes` fails, `build`, `tdd` and `mutate` fail too.
- **`bench-hook.sh [bin]`**: times 200 `crew hook` runs with the daemon up and down. It prints p50/p95 and fails over budget (20 ms / 60 ms p95). Each side gets 20 warmup runs that it does not count, then at least three rounds of 200. It judges the p95 of the lowest round. When no round meets the budget, it adds rounds, up to six. A noisy neighbour only adds time, and one bad burst must not fail a fast hook. CI runs it with `BUDGET_SCALE=2`, because its runners start processes about 3x slower.
- **`dev`** (`make dev [SEED=3] [FAKES=1]`): runs crew from this checkout: it builds, starts the dev daemon and rebuilds on each change.
  - It uses its own `CREW_HOME` (`/tmp/crew-dev-$UID`) and tmux socket (`crew-dev`). Thus the installed crew and `~/.crew` do not change.
  - In the background, it polls the Go sources each second. On a change, it builds again, restarts the dev daemon. Sessions continue, as they do across all daemon restarts.
  - A failed build does not stop the running instance. It shows the first error on the dev tmux server. The full output goes to `dev.log` in the dev home.
  - `SEED=n` runs `crew debug seed n`. `FAKES=1` puts the e2e fake `claude` and `codex` first on `PATH`. They hold their pane and use no quota.
  - `scripts/dev stop` stops the watcher and the dev daemon.
  - `CREW_DEV_HOME` and `CREW_DEV_SOCKET` move the instance. Keep the home short and under `/tmp`, because macOS limits Unix socket paths to 104 bytes. See [ADR 0039](../docs/adr/0039-dev-loop-and-build-handshake.md).
- **`web-screenshot < steps`**: renders the web app for the body of a PWA PR. It starts the Vite dev server with the fake API on 127.0.0.1 (`WEB_SHOT_PORT`, default 5199). The fake API (`web/fake-api.ts`) does these things:
  - `hello` reports `v1` and build `v0.12.0+demo`.
  - Pairing accepts `ABCD2345`, answers `ZZZZZZZZ` with 429 and all other codes with 401.
  - `/api/v1/stream` sends a demo state with every group, both limits and two queued sends on the running `s3`.
  - `GET …/messages` answers each session with a chat of tool rows (done with a test result, failed, running) and Markdown. It answers its older page after 5 s, so a shot can catch the loading row.
  - Send, unsend and interrupt answer success.
  - `GET /api/v1/sessions/s1/browser` is live with the demo page `web/scripts/demo-headless.png`. Other sessions have no headless tab. `POST /api/v1/browser/cookies` answers 3 cookies.
  - With `CREW_FAKE_STREAM=offline`, it drops the first stream after 300 ms and refuses the rest, for the offline state.
  - With `CREW_FAKE_STREAM=late`, it closes the first stream with 4401 after 300 ms, while `GET /api/v1/workspaces` still answers. Thus the app keeps its login and connects again.
  - With `CREW_FAKE_STREAM=revoked`, it does the same, but `GET /api/v1/workspaces` answers 401. This gives the pairing screen with its signed-out note.

  It controls Playwright's Chromium from stdin steps: `device <Playwright device>` (default `iPhone 15`), `mode browser|installed` (installed sets `navigator.standalone`), `goto <path>`, `fill <label>=<text>`, `click <button name>`, `tab <tab name>`, `see <text>`, `wait <ms>`, `shot <file>` (full page, relative to the cwd). `device` and `mode` start a fresh browser context. Playwright is pinned in `web/package.json`. Install its browser one time with `cd web && npx playwright install chromium`. Push the images to the orphan `pr-assets` branch.
- **`install.sh`**: installs the newest beta or stable release (an alpha only with `CREW_VERSION`) as `crew`. It also copies `nvim/lua` and `nvim/plugin` to `${XDG_DATA_HOME:-~/.local/share}/crew/nvim`. To try a release build:
  1. Run `goreleaser release --snapshot --clean`.
  2. Serve `dist/` with `python3 -m http.server`.
  3. Run `scripts/install.sh` with `CREW_DOWNLOAD_BASE`, a temp `CREW_INSTALL_DIR` and a temp `XDG_DATA_HOME`.

  See [ADR 0040](../docs/adr/0040-first-run-walkthrough.md).
- **`readme-shots`** (`make readme-shots`): makes all README images in `docs/images/readme/` from seeded demo data in a temp folder, never a real home or project.
  - Desktop and phone: `scripts/web-screenshot` with the fake API, light theme (`desktop-*.png` at 1280x720, `phone-*.png`).
  - If `oxipng` is on `PATH`, it optimizes each PNG. It fails when a PNG is larger than `README_SHOT_LIMIT` (default 400 KB).
- **`verify`** (`go run ./scripts/verify <command>`): the agent verification CLI (ADR [0055](../docs/adr/0055-agent-verification.md)). It is not in the `crew` binary. Agents (Claude Code and Codex) follow the skill in [.claude/skills/verify/SKILL.md](../.claude/skills/verify/SKILL.md).
  - Each command prints exactly one JSON object with `ok`, `problems` (`{msg, hint}`) and its data. The exit code is 0 for ok, 1 for a failure and 2 for a usage error.
  - Its state is in `VERIFY_HOME` (default `/tmp/crew-verify-$UID-<hash of the checkout path>`). Thus each checkout has its own isolated crew, and parallel verifiers in different worktrees do not collide. `verify` exports `VERIFY_HOME` to the recipes that it runs.
  - `doctor`: the tools (go, git, tmux, node 22.18+, `web/node_modules`, the Playwright Chromium), the branch, the machine load, TCP port 5199 and `/tmp`.
  - `iso up [--session] [--env-fakes]|down|seed [--sessions n] [--codex]|crew|dump|homesum|leaks|panes|file|api`: an isolated crew.
    - It has a `CREW_HOME` under `/tmp`, its own tmux socket, its own TCP ports and a temporary `HOME`.
    - The e2e fakes (`claude`, `codex`, `gh`, `terminal-notifier`, `osascript`) are first on `PATH`. Slack, ntfy and GitHub tokens are blank.
    - `up` starts `crew serve` and the Vite dev server (`CREW_API`). It pairs the device `TEST-verify` with `crew remote pair` and `POST /api/v1/pair`. It never prints the token.
    - `up` writes TEST files into the temporary `HOME` (`.gitconfig`, `.claude.json`, `.claude`, `.codex`, `.omp`, `.config/gh`, `.ssh`) and sets `SSH_AUTH_SOCK` to a TEST path in the isolated home.
    - `--env-fakes` puts fake `claude`, `codex` and `omp` programs (in `$CREW_HOME/fakes`) first on `PATH`. Each fake writes its environment and `CREW_ARGV` to `$CREW_HOME/dumps/<harness>.<pid>.env`, sends `SessionStart` with a session id from its work dir, and then waits on its input. The environments recipes use them (see [features/environments.md](../features/environments.md)).
    - `crew [--expect s] [--absent s] [--stdin text] -- <args>` runs the isolated `crew`. `--stdin` gives the command its input, for example a TEST secret for `crew env set`.
    - `dump [--clear] [<harness> --has K=V --set K --unset K --save n --same n --ignore K --wait s]` checks the newest dump of a fake. A problem names the variable, never its value.
    - `homesum --save n | --check n` compares checksums of the TEST files of the temporary `HOME`.
    - `leaks <text> [--api path]...` fails when the text is in `ps` (except the lines of `iso leaks` itself), in a `*.log` of the isolated home, or in the `serve` answer of each path.
    - `panes [--expect s] [--start s] [--kill s]` reads and kills the panes of the isolated tmux server by their start command.
    - `file {home}/<path> [--expect s]` checks a file in the isolated home. `api <METHOD> <path> [--body json] [--status n] [--expect s] [--absent s]` calls `serve` with the token of the paired device. In all helpers, `{home}` is the isolated `CREW_HOME`.
    - `--session` makes the repo `TEST-live` and runs `crew new` in it. The fake `claude` runs `$CREW_HOME/chat.sh` through its `run` step. The script echoes each typed line as `TEST echo: <line>`, writes a Claude transcript and fires `UserPromptSubmit` and `Stop`. Each hook sends the same `session_id` on each start in the worktree, thus the session can resume. The result has `session`, `pane` and `worktree`.
  - `web shot <route> [--viewport mobile|desktop|both]` and `web drive <route> --steps '<json>'`: `web/scripts/verify-drive.ts` with the Playwright of `web/`.
    - Steps: `goto`, `click`, `fill` (with `value`), `press`, `wait`, `expect` (`absent`), `shot`, `aria`, `eval`.
    - A locator has one of `role`+`name`, `testId`, `label`, `placeholder` or `text`. It acts on the first visible match.
    - The viewports are 390x844 and 1440x900 at 2x. It refuses a shot of a different size.
    - It waits until no `/api/` request runs for 700 ms. Console errors, page errors and failed API calls fail the command.
    - `--fake` uses the fake API with no `iso`. `--video` records each viewport (mp4 when `ffmpeg` is on `PATH`).
  - `app shot <route>` and `app drive <route> --steps '<json>'`: the real Tauri app through `tauri-driver`, with the steps and locators of `web`.
    - It builds the web app, `crew` (next to `crew-desktop`) and the debug app. Cargo uses `VERIFY_CARGO_TARGET` (default `/tmp/crew-verify-cargo`).
    - The app runs with the iso `CREW_HOME`, tmux socket and `HOME`, no `CREW_URL` and `PATH=/usr/bin:/bin` (a macOS GUI launch). Thus it starts its own `crew serve`. Under `xvfb-run` when there is no `DISPLAY`.
    - `desktop/e2e/verify-drive.mjs` plays the steps over WebDriver. It closes the first-run sheet after each `goto`. It does not capture console errors or failed API calls.
  - `map status` and `map run <area> [--recipe <label>]`: the recipes in `features/`.
  - `evidence init|add|verify <dir>`: the evidence bundle and the proof bar of ADR 0055. `add` refuses a proof when the checkout is not at the ref of the proof.
  - `design-check [--base ref] [--diff file]`: added lines only.
    - In `web/src`, no raw colours outside `--token:` lines, and no `px` in `.ts` or `.tsx`.
  - `design compare <shot.png> <frame|ref.png> [--crop x0,y0,x1,y1] [--max-diff 0..1] [--out f]`: puts a shot next to an approved design frame and a pixel diff.
    - A frame number `1` to `6` is `docs/design/redesign/<n>.png`. `--crop` selects one frame of that canvas, in reference pixels. The tool scales the crop to the size of the shot.
    - The result has `diff_ratio` (the part of the pixels that differ) and `out` (default `design-compare.png` next to the shot). The diff panel shows the differences in red. Above `--max-diff`, the command fails, but it keeps the image.
  - `annotate --before b.png --after a.png [--crop x0,y0,x1,y1] [--box ...] [--caption-before t] [--caption-after t] --out f`: a before/after pair.
  - `assets push --dir <n> files...` writes to the orphan `pr-assets` branch with plumbing commands. It prints commit-pinned raw URLs. `assets check` fails when the branch adds an image.
  - `selftest`: `go test ./scripts/verify/`. Its tests use a fake `sys` (no tmux, node or network) and real temporary repos.
- **`land`** (`go run ./scripts/land check|verdict|merge|watch|ledger <pr>`, `go run ./scripts/land digest --since 24h`): the merge helper of step 9 in the root `AGENTS.md` (ADR 0055). It uses the same JSON and exit codes as `verify`. It reads GitHub with `gh`.
  - `check`: `landable` is true when the PR is ready by the repo rule. The blockers are:
    - a draft, a mergeable state that is not `clean` or `behind` (the merge queue updates a branch that is behind), open review threads (or an unknown thread state), changes requested
    - a required check of the branch protection (`build`, `tdd`, `mutate`) that is not green. When it cannot read the protection, every check blocks.
  - `check` also gives `flags` for the daily review. A flag does not block, unless you add `--strict`. The flags are:
    - no `PASS` or `PASS+NOTES` verdict for the current head
    - self-or-CI changes: `.github/`, `.coderabbit*`, `scripts/land`, `scripts/verify`, `.claude/skills`, `scripts/tdd-check`, `scripts/mutate`, `scripts/lint-*`, `.golangci.yml`
    - irreversible effects: destructive SQL in `internal/adapters/sqlite/migrations` (also split over lines), a removed or renamed migration, `.goreleaser.yaml`, `scripts/install.sh`, the release workflow, setup code (`cmd/crew/setup*`, the adapter `setup` files, `internal/adapters/onboard`), cleanup code (`internal/app/cleanup*`, `internal/domain/cleanup*`, a new `git worktree remove`), env files
    - a file with no patch (it was not scanned), and no `.claude/skills/verify/SKILL.md`.
  - `verdict <pr> --verdict PASS|PASS+NOTES|FAIL|HUMAN [--bundle dir] [--notes t] [--dry-run]`: posts `<!-- land:verdict v=1 sha=<head> verdict=<X> -->`. A `PASS` needs a bundle that `verify evidence verify` passes, for the PR head.
  - `merge [--strict]`: runs `check`, then follows `mode` in `scripts/land/config.json`. `live` (the default) adds the `queue` label when the PR is ready and reports `queued`. The merge queue (ADR 0058) then merges it. `shadow` only writes the ledger. `off` does nothing.
  - `watch`: reads the checks of the merge commit. A red check is a regression: open a revert PR and tell the owner.
  - `ledger [pr]`: the decisions, with their flags. Each decision is one JSON comment on the open issue with the label `land-ledger`. `merge` makes that issue when there is none.
  - `digest --since 24h`: the merged PRs of the period with their flags, as JSON and as a short Markdown summary (`markdown`). The owner uses it in the daily review.
  - Its tests are in `scripts/land`, with a fake `gh`.
- **`loops/`**: the three scheduled agent loops of ADR [0055](../docs/adr/0055-agent-verification.md). They run on the Linux server as systemd user timers, because only that machine has tmux, Playwright and the isolated crew.
  - `run <loop>` makes a fresh detached worktree of `origin/main` under `~/.local/state/crew-loops`, then runs `claude -p "$(cat scripts/loops/<loop>.md)" --permission-mode bypassPermissions` in it under `timeout`. Extra worktrees go under `$CREW_LOOP_WORK`. On exit, it runs `verify iso down`, then `cleanup`: it backs up uncommitted changes as a patch under `~/.local/state/crew-loops/backup`, keeps each worktree that a process uses, never deletes a branch, and removes the rest (tests: `go test ./scripts/loops/`). When the timeout stops a patrol run, it posts the `run-end`. A `flock` stops a second local run of the same loop. The last output is in `~/.local/state/crew-loops/<loop>.last.log` and in the journal (`journalctl --user -u crew-loop-<loop>`).
  - The prompt comes from `origin/main`, thus a prompt change takes effect after its PR merges.
  - `patrol` (each hour at :07, 55 min limit): Phase A babysits and queues the agent PRs (step 9 of the root `AGENTS.md`) and runs `land watch` on merged PRs. Phase B finds, proves and opens one new fix. Its lock is the `patrol run log` issue (`run-start <UTC>` and `run-end` comments).
  - `maintenance` (each day at 02:30 America/Sao_Paulo, 110 min limit): one `docs(features): map maintenance` PR of map fixes, which the merge queue merges by step 9.
  - `digest` (each day at 08:00 America/Sao_Paulo, 15 min limit): posts `go run ./scripts/land digest --since 24h` to the pinned `Daily merge review` issue. It also sends it through ntfy when `/etc/homelab-notify.env` is readable by the user.
  - `install` copies `run` and `cleanup` to `~/.local/share/crew-loops/` and the units in `units/` to `~/.config/systemd/user/`. It fills in the repo path and the current `PATH`, backs up each file that it changes, and enables the timers. It does nothing to a file that did not change. `install --remove` disables the timers and removes the files (with backups).
  - The timers need lingering (`loginctl enable-linger`) to run when no one is logged in.
