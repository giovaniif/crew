# cmd/crew

`main`: one binary that is the daemon, the CLI, the API server of the app and the hook handler. The standard library dispatches the subcommands. See [ADR 0002](../../docs/adr/0002-cli-and-ci-tooling.md).

## Startup cost

Keep startup light. Each `crew hook` pays for package init, and `modernc.org/sqlite` init already takes about 4.5 of the 5 ms locally. `scripts/bench-hook.sh` guards the 20 ms p95 hook budget. For the same reason, do not use chroma's `lexers`/`styles` packages (see [internal/syntax/](../../internal/syntax/AGENTS.md)).

## The hook

Hooks call `crew hook`. It writes one message to the socket and exits. It never waits for the daemon for more than 50 ms, and never blocks the agent. If the daemon is down, it drops the event and writes a log line to `hook.log`. It connects to the socket directly, not through `rpc.Client`. It sends one `hook` request and closes without reading the reply. The exception is an event whose stdout the harness reads (`UserPromptSubmit`). For that event, it waits a maximum of the same 50 ms, and prints nothing on timeout. See [ADR 0006](../../docs/adr/0006-hook-ingestion.md).

**The mate gate (`PreToolUse`).** The hook classifies the tool call with `domain.ClassifyAction` before it sends the event ([ADR 0053](../../docs/adr/0053-mates.md)). The root is `CLAUDE_PROJECT_DIR`, else the `cwd` of the payload. The hook resolves symlinks with `filepath.EvalSymlinks` (the deepest part of the path that exists).
- A safe call does not change: the hook sends the event and does not wait.
- A dangerous call puts the `action` in the `hook` params and waits a maximum of 50 ms for the reply. The hook prints the `output` of the reply. For a mate session that the gate stops, this is a `PreToolUse` deny with the reason "waiting for owner approval". For other sessions, the reply is empty.
- If the daemon does not reply in 50 ms, the hook prints nothing and the call runs.
- Tests: `go test ./cmd/crew/ -run PreToolUse`.

## Version

`-ldflags -X` stamps `internal/version.Version` and `.Commit` (`make build`, `scripts/dev`, releases). If there is no commit stamp, the commit is the VCS revision from the Go build info. The build handshake that uses them is in [internal/rpc/](../../internal/rpc/AGENTS.md). `crew version --build` prints only `version.String()`, the exact string that the handshake compares. The Mac app reads its build from the bundled binary this way.

## Subcommands

- `crew` with no arguments tells you to open the crew app, prints the usage and exits 2. There is no TUI ([ADR 0062](../../docs/adr/0062-remove-the-tui.md)). Test: `go test ./cmd/crew/ -run CrewWithNoArguments`.
- `crew daemon [start|status|stop]`: `crew daemon` runs in the foreground. The other forms are in [internal/daemon/](../../internal/daemon/AGENTS.md).
- `crew workspace add <path>|list|remove <path>` registers workspaces through the daemon (it starts automatically). This step is optional: `session.new` registers a folder that it does not know. `list` shows `-` for the git facts of a repo until the first background refresh is done.
- `crew new [--workspace p] [--harness claude|codex|omp] [--model m] [--effort e] [task]` starts a session. Without `--workspace`, it uses the last workspace. New single-repo worktrees go under `$CREW_HOME/worktrees`.
- `crew focus <id>` focuses a session through the daemon. A `terminal-notifier` banner runs it on click.
- `crew automation list` prints each automation, its trigger and its source file, then the problems. `crew automation show <name>` prints one automation from the same list. `crew automation run [--work-item w] <name> [context...]` starts a run. With `-` as the context, it reads the context from stdin. `crew automation runs [name]` and `crew automation rerun <run id>` show and repeat runs. `crew automation trust <name>` approves a repo automation of the current folder. `crew automation list --mate <m>` prints only the automations of a mate. `crew automation link <name> --mate <m>` links an automation to a mate (`--mate ""` removes the link) through `automation.save`. Tests: `go test ./cmd/crew/ -run Automation`.
- `crew mate list` prints each mate and then the problems. `crew mate show <name>` prints one mate and its prompt. `crew mate remove <name>` deletes it. `crew mate set <name> [--agent a] [--prompt p] [--model m] [--effort e] [--repo r]... [--no-repos] [--owner id] [--avatar id] [--color #rrggbb] [--env e] [--enable|--disable]` makes a mate or changes the fields that you name and keeps the others. A new mate starts enabled. `--repo` can repeat, and it replaces the list. The daemon does the validation.
  - `crew mate add <name> [--agent a] [--prompt p]` makes the mate (the agent is `claude` and the prompt is short, unless you give them). It asks for no Slack tokens. The mate is `ready` at once ([ADR 0056](../../docs/adr/0056-local-mates.md)). It refuses a name that exists.
  - `crew mate new <name> [--repo r] [text]` starts a new conversation with the mate (`mate.new`) and prints the session ID. The words after the name are the first prompt.
  - `crew mate memory <name>` prints the path, the size and the text of the memory file of the mate (`mate.memory`).
  - `crew mate slack <name> [--no-open]` connects a mate to Slack. It prints the Slack app manifest and the api.slack.com "new app from manifest" link, and opens the link when it can (`open` on macOS, `xdg-open` on Linux). Then it asks for the bot token (`xoxb-`) and the app token (`xapp-`) and sends them with `mate.set_tokens`. A terminal does not echo the input. Without a terminal, it reads one line for each token. If a token is wrong, the mate stays and the command tells you to run `crew mate tokens <name>`.
  - After the tokens are stored, `slack` and `tokens` call `mate.claim` and print the one-time code. The user sends it to the mate in a direct message in Slack in 10 minutes, and becomes the owner. `crew mate claim <name>` prints a new code. Use it to change the owner.
  - `crew mate pause <name>` and `crew mate resume <name>` stop and start one mate (`mate.pause`, `mate.resume`). `crew mate stop` stops all mates (`mate.stop_all`), and `crew mate stop --off` lets them start turns again.
  - `crew mate tokens <name>` asks for the two tokens again. `crew mate tokens <name> --clear` removes them. No command prints a token.
  - Tests: `go test ./cmd/crew/ -run Mate`. See [ADR 0053](../../docs/adr/0053-mates.md).
- `crew env exec [<env> [--harness claude|codex|omp]] -- <program> [args...]` starts a program in an environment (ADR 0061). With `--harness`, the program gets only the account part of that harness (`domain.BuildEnv`), and only that harness dir is seeded. The daemon always sets `--harness`. It reads `[[env]]` from `config.toml` and the secrets from `$CREW_HOME/secrets/env/<env>/` (`internal/adapters/envstore`), makes the environment with `domain.BuildEnv` and calls `syscall.Exec`. It does not call the daemon. With no name, or `local` with no extra variables, the environment does not change. An unknown environment exits 1 with its name. A program that is not on `PATH` exits 127. Errors never hold a value. Tests: `go test ./cmd/crew/ -run EnvExec` (a helper process runs the real `syscall.Exec` into a shell that dumps its environment).
  - Before the exec, a custom environment sets up the harness dir of each set part (`seedEnv`, issue #760). Thus a fresh dir starts at the prompt and the crew hooks run. This occurs at each start and resume of a mate, because only then crew knows the work dir and the secrets. A second run changes nothing. An error is a warning on stderr, and the program starts.
    - Claude (`$CLAUDE_CONFIG_DIR`): `claude.Setup` into `settings.json`, and `claude.Seed` into `.claude.json`: `hasCompletedOnboarding`, `projects.<dir>.hasTrustDialogAccepted` for the work dir (and its real path), and `customApiKeyResponses.approved` with the last 20 characters of `ANTHROPIC_API_KEY` when the environment has that key.
    - Codex (`$CODEX_HOME`): `codex.Setup` into `hooks.json`, and `codex.Seed` into `config.toml`: the provider `crew-openai-env` with `env_key = "OPENAI_API_KEY"` (only when `model_provider` is not set and `$CODEX_HOME/auth.json` does not exist), and `[projects."<dir>"] trust_level = "trusted"`. The hook trust comes from `--dangerously-bypass-hook-trust` on the launch, not from the seed. When `auth.json` exists (a ChatGPT login), the seed does not set the provider, and it removes the `model_provider` line that it added before. A provider that the user set stays.
    - omp (`$PI_CODING_AGENT_DIR`): `omp.Setup` (the hook file), and `omp.Seed` writes `startup.setupWizard: false` into `config.yml`. A test by hand with omp 18.12.6 (issue #759) showed that this seed starts omp at its prompt with no setup wizard and that the crew hooks fire. omp also writes caches into `~/.omp` (not `agent/`), but no login.
    - The local environment is never set up: its dirs are the real dirs of the user.
    - Tests: `go test ./cmd/crew/ -run SeedEnv` and `go test -tags integration ./cmd/crew/ -run EnvSeedIntegration`. The integration test needs `tmux`, `claude` and a `codex` with `hooks.json` support (0.164 was tested). It uses a fake `HOME`, its own tmux socket and TEST values only. It checks that each harness shows its prompt with no first-run dialog, and that a crew hook gets to a fake `crew.sock`.
- `crew env list|show|create|set|unset|login|ssh-key|delete` manage environments through the daemon (`env.*`, see [internal/rpc/](../../internal/rpc/AGENTS.md)). `list` and `show` print names, the kind, the parts, the mates that use the environment and "set" or "not set" for each secret, never a value.
  - `crew env create <env> [--kind custom|local] [--part p]... [--git-name n] [--git-email e]`. The default kind is `custom`. The kind is fixed.
  - `crew env set <env> <VAR>` reads the value from stdin, or from a prompt that does not echo on a terminal. A value on the command line (`set <env> VAR value` or `VAR=value`) is refused, so the value is not in the shell history or `ps`. `crew env set <env> [--part p]... [--git-name n] [--git-email e]` changes the parts or the git identity. `crew env unset <env> <VAR>` removes a secret.
  - `crew env ssh-key <env> [--make|--rotate|--confirm|--import]` prints the public key. `--rotate` keeps the old key until `--confirm`. `--import` reads a private key from stdin.
  - `crew env login <env> [--harness claude|codex|omp]` runs the login of the harness in the environment (through `crew env exec <env> --harness <h>`). The default is `claude`: it runs `claude setup-token`. Then store the token with `crew env set <env> CLAUDE_CODE_OAUTH_TOKEN`. With `omp`, it runs `omp login` (the OAuth login of a provider). omp keeps the login in `agent.db` of `$CREW_HOME/envs/<env>/omp`. The personal `~/.omp/agent` does not change. Test: `go test ./cmd/crew/ -run EnvLogin`.
  - `crew env login <env> --harness codex` runs `codex login --device-auth` through `crew env exec <env> --harness codex`. Codex writes `auth.json` into `$CREW_HOME/envs/<env>/codex`, never into `~/.codex`. This ChatGPT login needs no `OPENAI_API_KEY`. `env.show` reports it as `codex_login`. Test: `go test ./cmd/crew/ -run EnvLogin` (a stub `codex` and a fake `HOME`).
  - `crew mate set <name> --env <env>` selects the environment of a mate. The daemon refuses an environment that does not exist. Each change applies at the next start or resume of a mate, and the output says so.
  - Tests: `go test ./cmd/crew/ -run 'Env|MateSet'`.
- `crew approval list` prints the pending approvals of mates: ID, mate, action, the Slack user ID of the requester, the time until it expires and the input. `crew approval approve <id>` and `crew approval deny <id>` decide one as the owner (`approval.decide`). Tests: `go test ./cmd/crew/ -run Approval`.
- `crew setup serve [--remove] [--addr host:port] [--cert file --key file | --self-signed] [--url https://host]` keeps `crew serve` running. On Linux, it uses a systemd user unit (`crew-serve.service`). On macOS, it uses the launchd agent `dev.crew.serve`. The service gets the PATH and `CREW_HOME` of the shell that ran the command.
  - It writes the flags in a fixed order. Thus the same arguments change nothing, and different arguments make a backup and write the file again.
  - Like `serve`, it refuses plain HTTP off loopback.
  - Tests: `go test ./... -run 'SetupServe|Systemd|Launchd'`. They put a fake `systemctl` / `launchctl` on `PATH` and use a temp `HOME`, never `~/.config/systemd` or `~/Library/LaunchAgents`. See [ADR 0046](../../docs/adr/0046-remote-app.md).
- `crew setup daemon [--remove | --check]` keeps `crew daemon` running. On Linux, it uses the systemd user unit `crew-daemon.service`. On macOS, it uses the launchd agent `dev.crew.daemon`.
  - The service gets the current `CREW_HOME` and the PATH of the login shell (`$SHELL -l -c`, through `internal/adapters/loginshell`), not the PATH of the caller. Thus a daemon set up through a bare `ssh -T` still gives agent panes a full PATH.
  - The install, backup and remove rules are the same as for `setup serve`. It logs to `$CREW_HOME/daemon-service.log`.
  - The unit has `Restart=on-failure`, and the agent has `KeepAlive` with `SuccessfulExit` false. Thus a clean exit (for example, a second daemon of the same build) does not start the daemon again, and a crash does. Run the command again to write an old unit again. It keeps a `.bak` copy.
  - When the unit or agent is installed for this `CREW_HOME` and runs this `crew` (after symlinks), a client that finds no daemon starts it through the service manager (`systemctl --user reset-failed` and `start crew-daemon.service`, or `launchctl kickstart gui/<uid>/dev.crew.daemon`), not as a detached fork. `domain.DaemonStart` makes this decision. If the start fails, the client forks as before.
  - With the systemd unit installed, `crew daemon stop` runs `systemctl --user stop crew-daemon.service`. It sends SIGTERM only when a daemon outside the unit still runs. A client that starts later (for example, a running `crew serve`) starts the daemon again through the unit. On macOS, `stop` sends SIGTERM, and the agent does not start the daemon again after this clean exit.
  - On Linux, if `loginctl show-user $USER -p Linger` is not `Linger=yes`, it tells you that the daemon stops at logout. It prints `sudo loginctl enable-linger $USER`.
  - `--check` prints `{"installed","running","linger","exec_ok","failing","reason","hooks_missing"}` as JSON for the Mac app. On macOS, `linger` is always true. An old app ignores the new fields.
    - `hooks_missing` lists each harness (local, or a seeded custom environment) whose crew hooks another tool removed, with a reason (`domain.CheckHooks`). It does not set `failing`, because `failing` is only for the daemon unit and the fix of the desktop app installs the unit again.
    - On Linux, `exec_ok` is false when the `ExecStart` binary of the unit does not exist or is not the `crew` that runs the check (after symlinks). `systemd.Program` reads the binary from the unit file.
    - `failing` is true when `exec_ok` is false, or when `systemctl --user show` (`systemd.Show`) reports a restart loop: `activating`/`auto-restart`, or `NRestarts` > 0 with an `ExecMainStatus` that is not 0. A `failed` unit also counts, and `Result=start-limit-hit` tells that systemd stopped after too many quick restarts. A unit with `Restart=always` (or an agent with `KeepAlive` true, on macOS too) is failing, because it can loop after a clean exit.
    - `reason` tells the problem in plain words. `domain.DaemonUnitHealth` makes this decision. On macOS, `failing` is true only for an agent with `KeepAlive` true.
    - Test: `go test ./cmd/crew -run SetupDaemonCheck`.
  - Tests: `go test ./cmd/crew/ -run SetupDaemon`. They put a fake `systemctl`, `launchctl`, `loginctl` and login shell on `PATH`, with a temp `HOME`. See [ADR 0049](../../docs/adr/0049-macos-app.md).
- `crew notify stream` prints the banners and withdrawals of the daemon as JSON lines. It never starts a daemon. It waits for one, because a daemon started through the bare `ssh -T` of the bridge gives each agent pane that PATH without login.
  - `crew notify bridge [--remote-bin path] <ssh host>` runs it through `ssh` on the Mac when the daemon is on a remote host. It posts each banner locally and connects again automatically.
  - `crew setup bridge [--remote-bin path] [--remove] <ssh host>` keeps the bridge running as a launchd agent.
  - Tests: `go test ./... -run 'NotifyStream|NotifyRelay|NotifyBridge|Launchd|SetupBridge'`. They use a temp dir and a fake `launchctl`, never `~/Library/LaunchAgents`. See [ADR 0016](../../docs/adr/0016-notifications-and-attention.md).
- `crew remote pair [--name n] [--url u]` asks the daemon for a pairing code. It prints a QR code, the URL `https://<url>/#pair=<code>` and the expiry.
  - `--json` prints only `{"code","expires_at"}` and needs no URL. The desktop app uses it to pair with its own `crew serve` (see [desktop/](../../desktop/AGENTS.md)).
  - The QR code uses half blocks with explicit 256-colour black on white, with the quiet zone. Thus it does not depend on the terminal theme.
  - When stdout is not a terminal or `NO_COLOR` is set, it uses plain half blocks and draws the light modules.
  - When the terminal is narrower than the code, it does not draw the code and writes a warning on stderr. The width comes from the terminal or `COLUMNS`.
  - The URL comes from `--url` or `[serve] url` in `$CREW_HOME/config.toml`. If neither is set, it tells how to set one. It refuses an `http://` URL.
  - `crew remote devices` lists paired devices. `crew remote revoke <id>` removes one.
  - `testdata/qr.colour.golden` and `testdata/qr.plain.golden` pin the QR output (make them again with `go test ./cmd/crew -run RemoteQR -update`). The tests decode the modules back from both outputs.
  - It is not possible to test a camera here. To verify, run `crew remote pair` in a real terminal and scan it.
  - Tests: `go test ./cmd/crew/ -run Remote`. See [internal/daemon/](../../internal/daemon/AGENTS.md) and ADR 0046.
- `crew serve [--addr 127.0.0.1:7420] [--cert f --key f | --self-signed] [--url u]` runs the API of the phone app (see [internal/serve/](../../internal/serve/AGENTS.md)). It refuses plain HTTP off loopback before it starts anything. The public URL for the `Origin` check of the stream comes from `--url` or `[serve] url`. It starts the daemon if necessary. Tests: `go test ./cmd/crew/ -run Serve`.
- `crew rpc` is the one transport of the Mac app, local or through `ssh -T host crew rpc`.
  - It connects to `$CREW_HOME/crew.sock` and copies protocol lines in both directions between the socket and stdin/stdout. The line limit is `rpc.MaxMessage` (16 MiB).
  - It never starts a daemon. If nothing listens, it writes one `{"v":1,"id":0,"error":{"code":"unavailable",...}}` line and exits 1.
  - EOF on stdin half-closes the socket. When the socket closes, it exits with status 0. An oversized line ends it with status 1.
  - The copy code is in `internal/rpcpipe`. Depguard lets it import only `rpc`, `view` and `syntax` from `internal/`, and never `os/exec`.
  - The bridge answers one method itself, `view.subscribe`. It sends `subscribe` with the same `id` and `build`, and replies with the derived state and diffs of `internal/view` (see [internal/view/](../../internal/view/AGENTS.md)).
  - It also extends `review.open`. With `"tokens": true` in the params, it passes the request on and adds `Spans`, a list of `[start, end, class]`, to each diff line of the reply (see [internal/syntax/](../../internal/syntax/AGENTS.md)). A file with no lexer gets no `Spans`.
  - All other lines pass through with no change.
  - Tests: `go test ./cmd/crew/ -run 'Rpc|Tokens'` and `go test -tags integration ./test/integration/ -run RpcBridge`. See [ADR 0049](../../docs/adr/0049-macos-app.md).
- `crew browser [--session id] [--browser any|app|headless] [--json] [--out file.png] [--timeout 30s] <command> [args]` drives the browser of the app ([ADR 0051](../../docs/adr/0051-browser-in-mac-app.md), ADR 0060).
  - The commands are `goto`, `snapshot`, `click`, `fill`, `type`, `press`, `wait`, `screenshot`, `eval`, `tabs`, `cookies`, `set-device` and `console`.
  - `--browser app` uses only the attached app. `--browser headless` uses only the headless browser. With no flag, the daemon chooses. A different value exits 2.
  - `crew browser attach` is the control channel of the Tauri app. It sends `browser.attach`, writes each `BrowserCall` as one JSON line to stdout and sends each JSON line of stdin (`{"call","result"}` or `{"call","error"}`) with `browser.reply`. It exits 0 when stdin closes, and 1 when the daemon closes the connection. `domain.ParseBrowserCommand` checks the arguments.
  - The session is `--session`, else `$CREW_SESSION`, else the session on `$TMUX_PANE`.
  - It prints the `text` of the result (the tree of `snapshot`), a plain string, or else JSON. `--json` prints the full result.
  - `screenshot` writes the PNG to `--out`, else to a temp file, and prints the path.
  - Without the Mac app, it exits 1 with `no browser: the macOS app is not connected`. Bad arguments exit 2.
  - `crew setup claude` and `crew setup codex` also write the browser skill (see [internal/adapters/](../../internal/adapters/AGENTS.md)).
  - Tests: `go test ./cmd/crew/ ./internal/daemon/ ./internal/domain/ -run Browser`.
- `crew worktree list|assign <path> <session>` prints the path, branch, owner and PR of each worktree, and sets an owner.
- `crew cleanup [--dry-run]` runs (or only prints) the cleanup plan through the daemon (see [internal/daemon/](../../internal/daemon/AGENTS.md)).
- `crew pr <session id or name> [--json]` prints the PR board of a session from daemon state. `testdata/pr.json.golden` pins the JSON shape. To make it again, run `go test ./cmd/crew -run PRBoardJSON -update` and review the diff. [ADR 0024](../../docs/adr/0024-pr-board.md) documents the shape. Run the board tests with `go test ./... -run PRBoard`. The tests of the github adapter and the integration tests use a fake `gh` script, so nothing goes to GitHub.
- `crew review comment [--session id] (--file abs | --worktree id --path rel) --start n [--end n] [--code text] --body text` adds a draft comment. `crew review scope [--session id] [--scope s]` prints the path, base commit and files of each worktree as JSON. `crew review send [--session id]` sends the draft, or queues it until the agent is between tools. The default of `--session` is `$CREW_SESSION`, which the shell and nvim panes have.
- `crew setup claude|codex|omp [--remove]`: see [internal/adapters/](../../internal/adapters/AGENTS.md). `crew setup nvim [--remove]`: see [internal/adapters/onboard/](../../internal/adapters/onboard/AGENTS.md).
- `crew setup-worktree <path>`: see [internal/adapters/setup/](../../internal/adapters/setup/AGENTS.md).
- `crew statusline` runs the status line of the user, then reports model, effort, context left and rate limits.
- `crew debug seed N [--codex]` adds N fake Claude sessions, to try the app.
  - There are two sessions for each task, with one to three worktrees each, event logs and fresh limits. The Claude 5h window is 88% used, so the red state shows.
  - `--codex` makes every third session Codex, with Codex limits.
  - The first seeded session also gets three subagents: one is nested, two are running. Its PR is open with failing checks, so `crew pr seed-session-1` shows a PR board.
- `crew debug session [--once] <id>` prints the state, harness, pane, model, effort, context left and limit used of a session. Then it prints each change until you interrupt it. `--once` prints only the current line.
- `crew debug launch --harness claude --dir <dir> [--model m] [--effort e]` opens a harness pane in any dir, with no task or worktree.

## Migration from the alphas

`crew daemon`, `crew serve` and `crew setup` run `migrateState` (`migrate.go`) before they start. It does not run when `CREW_HOME` is set. It writes one `crew:` line on stderr for each step that it does. A second run changes nothing and writes nothing. The names of the alphas are only in `migrate.go`, in the `legacy*` files of the packages, and in their tests. The rules are in `internal/domain/migrate.go`.

1. **Services** (only `crew setup`): for each systemd or launchd file of the alphas in the systemd user dir or `~/Library/LaunchAgents`, it keeps a `.bak` copy, writes the `crew` file (`domain.RewriteServiceFile`), stops and removes the old service, and starts the new service after the other steps.
2. **Home:** it moves the old home dir to `~/.crew` and makes the old path a symlink to it. If a daemon answers on the old socket, it does not move the dir and tells you to run `crew daemon stop`. Until the move, `rpc.Home` uses the old dir. If both dirs exist, it uses `~/.crew` and does not change the old dir. It then removes the stale socket, pid and lock files of the old daemon, unless that daemon is live.
3. **Hooks:** if `settings.json` of Claude, `hooks.json` of Codex or the omp hook runs the old command, it runs the normal setup merge with the `crew` binary. The merge makes a backup first. The old omp hook moves to a `.bak` file. The old Claude settings backup moves to the new backup name.
4. **nvim:** it moves the old plugin dir in `$XDG_DATA_HOME` to `$XDG_DATA_HOME/crew`, makes a symlink, writes the new nvim setup file and moves the old setup file to a `.bak` file.
5. **Link:** it removes the link with the old command name that sits next to the binary.

The daemon finds the other old names itself. A client reaches a live old daemon through its socket. A new daemon does not start while an old daemon holds its lock. The repo config file, the browser skill and the turn refs of the alphas are read or moved when they are first needed, with a `.bak` copy. The state database renames the trust keys of automations in migration 0010.

The daemon uses the tmux server `crew`. While the old server has a parked agent pane, the daemon uses the old server and its old session name, so that no session stops (`domain.TmuxSocket`, `tmux.HasAgentPanes`).

Tests: `go test ./cmd/crew/ ./internal/domain/ ./internal/rpc/ -run 'Migrate|Home|Tmux|Legacy|Rewrite'` and `go test -tags integration ./internal/adapters/tmux/ -run HasAgentPanes`.
