# Environments

An environment is a named profile that a mate uses to start its agent (ADR [0061](../docs/adr/0061-environments-for-mates.md)). The kind `local` uses the logins of this machine. The kind `custom` is isolated. These recipes use only TEST values and fake `claude`, `codex` and `omp` programs that write their environment to a file.

The commands are not built yet. Each recipe is marked manual until its issue lands. The last issue of the "Environments for mates" tracking issue removes the marks.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
```

## Recipes

### list shows names and "set", never a value (manual: not built yet)

```sh
go run ./scripts/verify iso crew -- env create test-bot --kind custom
go run ./scripts/verify iso crew -- env set test-bot GH_TOKEN TEST-gh-token
go run ./scripts/verify iso crew --expect test-bot --expect custom -- env list
go run ./scripts/verify iso crew --expect "GH_TOKEN" --expect "set" -- env show test-bot
! go run ./scripts/verify iso crew -- env show test-bot | grep -q TEST-gh-token
```

### a custom environment is applied to a fake claude (manual: not built yet)

```sh
go run ./scripts/verify iso crew -- env set test-bot CLAUDE_CODE_OAUTH_TOKEN TEST-claude-token
go run ./scripts/verify iso crew -- mate set test-mate --agent claude --prompt "TEST prompt" --env test-bot
```

Start the mate with the fake `claude` first on `PATH`. Then check the dump of the fake:

- `CLAUDE_CONFIG_DIR` is `$CREW_HOME/envs/test-bot/claude`, and `CLAUDE_CODE_OAUTH_TOKEN` is the TEST value.
- `SSH_AUTH_SOCK` is not set. `GIT_CONFIG_GLOBAL` points into `$CREW_HOME/envs/test-bot`.
- The crew hooks are in `$CREW_HOME/envs/test-bot/claude/settings.json`.

Do the same for `--agent codex` (`CODEX_HOME`) and `--agent omp` (`PI_CODING_AGENT_DIR`).

### personal HOME files stay byte-identical (manual: not built yet)

Make a checksum of the fake personal HOME (`.gitconfig`, `.claude`, `.codex`, `.omp`, `.config/gh`, `.ssh`) before and after a start and a resume. The two checksums must be equal.

### the local environment does not change the launch (manual: not built yet)

A mate with no `env` starts with the same environment as before this feature. The dump of the fake is equal to the dump of a mate on `--env local`.

### no TEST value in ps, logs or answers (manual: not built yet)

While the fake runs, `ps -ef` shows `crew env exec test-bot --` and no TEST value. `grep -r TEST- "$CREW_HOME"/*.log` finds nothing. The `serve` answer for `/api/envs` has no TEST value.

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Use only TEST values. Never put a real token in the isolated crew.
- Environment names allow only lower case letters, digits, `-` and `_`. Use the `test-` prefix.
