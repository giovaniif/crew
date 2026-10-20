# Setup and onboarding

`S` opens "Set up crew": pick the agents, set up each one, then Neovim. The setup commands merge into the agent config idempotently, with a backup. In the isolated crew, `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are temporary, so the real config never changes. `iso up` marks the home onboarded, so the first-run walkthrough does not show.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
```

## Recipes

### S opens the setup with the three agents

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/setup --steps '[{"expect":"crew","timeout":8000},{"keys":"S"},{"expect":"Set up crew","timeout":5000},{"expect":"Claude Code"},{"expect":"Codex"},{"expect":"Oh My Pi"},{"shot":"setup.png"},{"keys":"Escape"}]'
```

### install on a fresh file says crew made the file (#482)

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/setup-backup --steps '[{"expect":"crew","timeout":8000},{"keys":"S"},{"expect":"Set up crew","timeout":5000},{"keys":"Enter"},{"expect":"does not exist yet","timeout":5000},{"keys":"Enter"},{"expect":"crew made the file","timeout":5000},{"absent":"does not exist yet"},{"keys":"Escape"}]'
```

### first-run walkthrough (manual: iso up marks the home onboarded; remove $CREW_HOME/onboarded in the isolated home and restart the TUI to see it)

### version --build prints the build version

```sh
go run ./scripts/verify iso crew --expect dev -- version --build
```

### version prints the version and the commit

```sh
go run ./scripts/verify iso crew --expect "crew dev (commit" -- version
```

### crew setup <agent> merges the agent config (manual: the S view drives the same setup; a recipe must not run it twice in one home)

### crew hook handles an agent hook event (manual: the agent calls it with a JSON event on stdin; iso crew does not pass stdin)

### crew rpc pipes JSON-RPC to the daemon (manual: it reads requests on stdin; iso crew does not pass stdin)

### crew daemon runs in the foreground (manual: iso up starts the daemon; a second one would conflict)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never run the setup outside the isolated crew. It edits `~/.claude` and `~/.codex`.
