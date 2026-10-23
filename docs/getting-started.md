# Getting started

## Set up the agents

Run these commands one time. Each command merges into the agent config, makes a backup first and can be undone with `--remove`.

1. Run `crew setup claude`. It adds the crew hooks and a status-line wrapper to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`).
2. Run `crew setup codex`. It adds the hooks to `~/.codex/hooks.json` (or `$CODEX_HOME`). Then start `codex` and accept the review prompt for the new hooks, or trust them in `/hooks`.
3. Optional: run `crew setup nvim`. It writes `~/.config/nvim/plugin/crew.lua`, which loads the plugin from `${XDG_DATA_HOME:-~/.local/share}/crew/nvim`.

Then open the crew app. The app is the only UI of crew ([ADR 0062](adr/0062-remove-the-tui.md)). `crew` with no arguments prints a hint and the usage.

## Mates in Slack

A mate is a named personality of crew in Slack. Each mate is its own Slack app, so it has its own name and avatar. The app uses Socket Mode. Your server needs no public URL and no open port. The app is not in the Slack Marketplace, so Slack does not review it. See [ADR 0053](adr/0053-mates.md).

To add a mate:

1. Run `crew mate add <name>`. The command saves the mate, prints the Slack app manifest and the link to make the app from it. It opens the link when it can. Add `--no-open` to only print it. Add `--agent codex` or `--prompt "..."` to set those fields.
2. In Slack, make the app from the manifest and install it in your workspace. A workspace admin can require an approval for the install. If so, ask the admin to approve the app.
3. Copy the bot token (`xoxb-`) from OAuth & Permissions.
4. In Basic Information, make an app-level token with the scope `connections:write`. Copy it (`xapp-`).
5. Paste the two tokens when the command asks. The terminal does not show them.
6. The command then shows a one-time code. In Slack, send the code to the mate in a direct message in the next 10 minutes. The mate replies, and you are its owner. Only the owner can approve a dangerous action. To get a new code, or to change the owner, run `crew mate claim <name>`.

When the mate has tokens and is enabled, the daemon connects it to Slack. The `states` of `mate.list` show if each mate is connected. If Slack refuses a token, the state is `error` with the Slack error code.

crew keeps the tokens in files with mode 600 under `$CREW_HOME/secrets/`. They are never in `config.toml`, a log or an answer of the daemon. If you gave a wrong token, run `crew mate tokens <name>`. To remove the tokens, run `crew mate tokens <name> --clear`.

## Build and test

You need Go (the version in `go.mod`) and `golangci-lint` v2. For `make mutate`, you also need `gremlins`.

```sh
make build             # ./bin/crew
./bin/crew version
./bin/crew debug seed 3   # 3 fake sessions for the app
./bin/crew workspace add ~/src/api && ./bin/crew new "fix the flaky test"
make test              # go test ./...
make lint              # golangci-lint + scripts/lint-comments
make e2e               # testscript suite in test/e2e
make bench             # benchmarks for the performance budgets
make mutate            # gremlins on internal/domain and internal/app
```

Integration tests use `-tags integration` and need `git` and `tmux`.

## Shell and nvim

The Shell tab of a session in the app runs a shell in its worktree. The Editor tab runs nvim there, with `CREW_SESSION` set. In nvim, `C-h/j/k/l` move between its splits.

`crew setup nvim` prints the exact lines for your install. To set it up by hand:

1. Put the plugin dir on the runtimepath, with your plugin manager or with `vim.opt.rtp:prepend('<dir>')`. The dir is `${XDG_DATA_HOME:-~/.local/share}/crew/nvim` from a release, or the repo's `nvim/` in a checkout.
2. Call `require('crew').setup({})`.

The plugin needs `crew` on `PATH`. It works in the nvim of the Editor tab, which has `CREW_SESSION` set.

- `:CrewDiff [last_turn|uncommitted|branch]` opens a review scope of the session in diffview. The default is the scope that the review pane has open.
- `:'<,'>CrewComment [text]` adds the selected lines as a draft review comment.
- `require('crew').setup({ bin = 'crew', tmux = 'tmux', navigate = true })`. With `navigate = false`, the plugin does not change `C-h/j/k/l` in nvim.
