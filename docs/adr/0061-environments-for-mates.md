# ADR 0061: Environments for mates

Status: proposed, 2026-10-23. Tracking issue: "Environments for mates". It amends [ADR 0053](0053-mates.md) and [ADR 0056](0056-local-mates.md).

## Context

A mate runs its agent with the HOME, ssh-agent, `gh` login and harness logins of the user on the daemon box. The owner wants some mates to work as a different identity: a bot GitHub account, another Claude account, or a work API key. The personal files and logins of the user must not go into such a mate.

Facts:

- The daemon starts each mate agent pane with `tmux new-window`. Variables that `tmux -e` sets show in `ps`, and `tmux -e` cannot remove a variable.
- ADR 0053 keeps secrets in files under `$CREW_HOME/secrets` (file mode 600, directory mode 700). ADR 0016 masks secrets in banners.
- The `claude` harness reads `CLAUDE_CONFIG_DIR`. The `codex` harness reads `CODEX_HOME`. The `omp` harness reads `PI_CODING_AGENT_DIR` (see `internal/adapters/omp/setup.go`).
- A test by hand showed this: with a fake `HOME`, a custom `CLAUDE_CONFIG_DIR` and no token, `claude -p` says "Not logged in". It writes only into the custom directory, and the fake `HOME` stays byte-identical.
- A test by hand with a real token (2026-10-23, Claude Code 2.1.309, Linux): with `env -i`, a fake `HOME`, a custom `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, `claude -p` answered correctly. The fake `HOME` stayed byte-identical. The real `~/.claude/.credentials.json` did not change. No file in the custom directory had the token.
- In that test, Claude wrote only into the custom directory: `.claude.json`, `backups/`, `projects/`, `sessions/`, and the organization files `remote-settings.json` and `policy-limits.json` with their signature and stamp files. Thus the settings that an organization manages for an account stay in the directory of the environment.

## Decision

### The environment

- An **environment** is a named profile that you can use again. It is on the daemon box. One or more mates use one environment.
- The mate definition gets a new field `env`. An empty value means the `local` environment.
- The definition (name, kind and the names of the set parts) is in `$CREW_HOME/config.toml` as `[[env]]`. The values are in `$CREW_HOME/secrets/env/<env>/` (file mode 600, directory mode 700), as ADR 0053 does.
- The harness directories of an environment are in `$CREW_HOME/envs/<env>/` (directory mode 700).

### Kinds

- **local**: the mate uses the HOME, ssh-agent, `gh` login and harness logins of this machine. This is the behavior of today. A local environment can also hold extra secret variables.
- The kind is fixed when you create the environment. The app shows a local environment as read-only, with "Duplicate as Custom…".
- **custom**: the mate is isolated. Each part is optional:

| Part | How crew applies it |
|---|---|
| Git identity | crew writes `$CREW_HOME/envs/<env>/gitconfig` with only `user.name` and `user.email`, and sets `GIT_CONFIG_GLOBAL` to it. Thus the credential helpers of `~/.gitconfig` do not go into the mate. |
| SSH | crew makes one ed25519 key for each environment and shows the public key. The user adds it on GitHub. crew sets `GIT_SSH_COMMAND="ssh -i <key> -o IdentitiesOnly=yes"` and removes `SSH_AUTH_SOCK`. You can also import a key. To rotate the key, crew keeps the old key until the user confirms that the new key is on GitHub. |
| GitHub | crew sets `GH_TOKEN` and an empty `GH_CONFIG_DIR` (`$CREW_HOME/envs/<env>/gh`). |
| Claude | `CLAUDE_CONFIG_DIR=$CREW_HOME/envs/<env>/claude`, and `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`. |
| Codex | `CODEX_HOME=$CREW_HOME/envs/<env>/codex` and `OPENAI_API_KEY`. The ChatGPT device login is a later issue. |
| Pi | `PI_CODING_AGENT_DIR=$CREW_HOME/envs/<env>/omp` and the API keys of the providers. |
| Extra variables | Secret variables with names that you select, for example `LINEAR_API_KEY`. |

### Launch

- Each mate agent pane starts with `crew env exec <env> -- <harness argv>`. This applies to the start and to the resume, for the `claude`, `codex` and `omp` harnesses.
- `crew env exec` reads the definition and the secrets. Then it calls a pure `domain` function that makes the environment. Then it calls `syscall.Exec`.
- For `local`, the function returns the current environment and adds only its extra variables. With no extra variables, the environment does not change.
- For `custom`, the function does these steps:
  1. It keeps only the variables of a fixed allowlist: `PATH HOME USER LOGNAME SHELL TERM COLORTERM LANG LC_* TZ TMPDIR TMUX TMUX_PANE CREW_HOME XDG_RUNTIME_DIR DISPLAY WAYLAND_DISPLAY`.
  2. It sets the managed variables of the parts in the table above.
  3. It sets the extra variables. An extra variable wins over a managed variable with the same name only when the name is not on the deny list.
- The deny list for names that the user types is `PATH HOME TMUX* CREW_* AGENTWS_* LD_* DYLD_*` and all managed variables. The validator refuses these names.
- Do not use `tmux -e` for secrets. It cannot remove a variable, and `ps` shows the values.
- The allowlist is fixed in v1. A setting to change it is a later issue.

### Hooks and first start

- crew sees the state of an agent only through `crew hook`. Thus crew installs its hooks into each harness directory of an environment: `settings.json` for Claude, `hooks.json` for Codex, and the `omp` hook file. The setup code of `cmd/crew` already takes an `env` function. It uses the directory of the environment in the place of the home directory.
- A new harness directory can stop at an onboarding screen. For example, Claude reads `hasCompletedOnboarding` and the trusted projects from `.claude.json`. A spike issue finds the minimum seed for each harness.

### Secrets stay secret

- A value never shows in `config.toml`, a log, an RPC answer, a `serve` answer, a notification or the app. The masking of ADR 0016 also applies.
- Clients show only the name, the kind, the parts and "set" or "not set". A client can set or remove a secret. It cannot read one.
- The public SSH key is not a secret. The app and `crew env ssh-key` show it.
- A change applies at the next start or resume of a mate. crew does not restart a running agent.

### Product

- Mates come first. Local harness sessions come second. Local sessions always use this machine and have no environment.
- Mates get threads in the app. Slack is optional.
- The app (PWA and Tauri desktop) gets an Environments page as its own navigation item, not in Settings, and an environment picker on the mate page. Mates becomes the home screen, and Sessions moves to second place in the navigation. The phone tabs are Mates, Sessions, Approvals and More.
- The owner approves the design in Claude Design first. The frames are files 7 to 10 of the Claude Design project `0b297492-6939-4049-b2a2-75e8d6501de3`. The design issue puts them in `docs/design/mates/`. The UI issues copy them exactly.
- The TUI gets no environment work. A separate change removes the TUI.

## Why

- `syscall.Exec` from a small wrapper puts secrets only into the environment of the agent process. `ps` shows only `crew env exec <env> -- ...`.
- An allowlist is safer than a deny list. A new variable on the box does not go into a custom mate.
- A pure function in `domain` makes the rules table-tested and mutation-tested.
- An empty `GIT_CONFIG_GLOBAL` and `GH_CONFIG_DIR` are the documented ways to stop git and `gh` from reading the logins of the user.

## Limits

- The mate still runs as the same Unix user. A mate can read files in the real HOME if it knows the path. An environment isolates logins and identity, not the file system.
- The Claude subscription login in a custom directory needs `claude setup-token`. The real-token check passed on Linux. The check of the macOS keychain is open. Do it on a Mac.
- Codex and Pi use API keys in v1. Their logins are later issues.
- The allowlist is fixed in v1.

## Amended (2026-10-23)

- Least access: a mate in a custom environment gets only the account part of its harness. A `claude` mate gets `CLAUDE_CONFIG_DIR` and the Claude token or key. A `codex` mate gets `CODEX_HOME` and `OPENAI_API_KEY`. An `omp` mate gets `PI_CODING_AGENT_DIR` and the Pi keys. The shared parts (`git`, `ssh`, `github`) and the extra variables go to each mate.
- The daemon starts the pane as `crew env exec <env> --harness <harness> -- ...`. `domain.BuildEnv` takes the harness. `crew env exec` seeds only the dir of that harness. With no `--harness`, all parts apply, as before.

## Amended by ADR 0063 (2026-10-23)

- An environment is now one machine plus one identity. `local` becomes the `yours` identity ("Your accounts"). `custom` becomes a separate identity. See [ADR 0063](0063-environments-are-machine-plus-identity.md).
