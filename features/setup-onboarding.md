# Setup and onboarding

`crew setup claude`, `crew setup codex`, `crew setup omp` and `crew setup nvim` set up each agent and Neovim. The setup commands merge into the agent config idempotently, with a backup. In the isolated crew, `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are temporary, so the real config never changes. `iso up` marks the home onboarded, so the first-run walkthrough does not show.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
```

## Recipes

### version --build prints the build version

```sh
go run ./scripts/verify iso crew --expect dev -- version --build
```

### version prints the version and the commit

```sh
go run ./scripts/verify iso crew --expect "crew dev (commit" -- version
```

### crew setup <agent> merges the agent config (manual: a recipe must not run it twice in one home)

### crew hook handles an agent hook event (manual: the agent calls it with a JSON event on stdin; iso crew does not pass stdin)

### crew rpc pipes JSON-RPC to the daemon (manual: it reads requests on stdin; iso crew does not pass stdin)

### crew daemon runs in the foreground (manual: iso up starts the daemon; a second one would conflict)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never run the setup outside the isolated crew. It edits `~/.claude` and `~/.codex`.
