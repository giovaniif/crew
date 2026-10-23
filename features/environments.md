# Environments

An environment is a named profile that a mate uses to start its agent (ADR [0061](../docs/adr/0061-environments-for-mates.md)). The kind `local` uses the logins of this machine. The kind `custom` is isolated. These recipes use only TEST values.

`iso up --env-fakes` puts fake `claude`, `codex` and `omp` programs first on `PATH`. Each fake writes its environment and its arguments to `$CREW_HOME/dumps/<harness>.<pid>.env`, then waits on its input. `iso up` also writes TEST files into the personal HOME of the isolated crew (`.gitconfig`, `.claude.json`, `.claude`, `.codex`, `.omp`, `.config/gh`, `.ssh`) and sets `SSH_AUTH_SOCK` to a TEST path. The helpers `iso dump`, `iso homesum`, `iso leaks`, `iso panes`, `iso file` and `iso api` check the result. In a value, `{home}` is the `CREW_HOME` of the isolated crew.

The recipes run in order. The first recipe makes the environment `test-bot` that the other recipes use.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session --env-fakes
go run ./scripts/verify iso homesum --save before
```

## Recipes

### list shows names and "set", never a value

```sh
go run ./scripts/verify iso crew -- env create test-bot --kind custom --part git --part ssh --part github --part claude --part codex --part pi --git-name "TEST bot" --git-email test-bot@invalid
go run ./scripts/verify iso crew --stdin sk-ant-oat01-TEST-claude-token -- env set test-bot CLAUDE_CODE_OAUTH_TOKEN
go run ./scripts/verify iso crew --stdin TEST-gh-token -- env set test-bot GH_TOKEN
go run ./scripts/verify iso crew --stdin sk-TEST-openai-key -- env set test-bot OPENAI_API_KEY
go run ./scripts/verify iso crew --stdin TEST-gemini-key -- env set test-bot GEMINI_API_KEY
go run ./scripts/verify iso crew -- env ssh-key test-bot --make
go run ./scripts/verify iso crew --expect test-bot --expect custom --expect "4 of 9" --absent TEST- -- env list
go run ./scripts/verify iso crew --expect "CLAUDE_CODE_OAUTH_TOKEN  set" --expect "ANTHROPIC_API_KEY        not set" --expect "GH_TOKEN                 set" --absent TEST- -- env show test-bot
go run ./scripts/verify iso api GET /api/v1/envs/test-bot --expect '{"name":"GH_TOKEN","set":true}' --expect '{"name":"ANTHROPIC_API_KEY","set":false}' --absent TEST-
```

### a custom environment is applied to a fake claude

```sh
go run ./scripts/verify iso dump --clear
go run ./scripts/verify iso crew -- mate set test-mate --agent claude --prompt "TEST claude prompt" --env test-bot
go run ./scripts/verify iso crew --expect "started a new conversation" -- mate new test-mate "TEST hi"
go run ./scripts/verify iso dump claude --has CLAUDE_CONFIG_DIR={home}/envs/test-bot/claude --has CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-TEST-claude-token --has GH_TOKEN=TEST-gh-token --has GH_CONFIG_DIR={home}/envs/test-bot/gh --has GIT_CONFIG_GLOBAL={home}/envs/test-bot/gitconfig --has "GIT_SSH_COMMAND=ssh -i '{home}/secrets/env/test-bot/ssh/id_ed25519' -o IdentitiesOnly=yes" --has HOME={home}/home --has CODEX_HOME={home}/envs/test-bot/codex --unset SSH_AUTH_SOCK --unset CREW_E2E --unset CREW_TMUX_SOCKET --unset XDG_CONFIG_HOME
go run ./scripts/verify iso file {home}/envs/test-bot/claude/settings.json --expect "crew hook"
go run ./scripts/verify iso file {home}/envs/test-bot/gitconfig --expect "TEST bot" --expect test-bot@invalid
go run ./scripts/verify iso panes --expect "env exec test-bot -- claude"
```

### a custom environment is applied to a fake codex and a fake omp

```sh
go run ./scripts/verify iso crew -- mate set test-codex --agent codex --prompt "TEST codex prompt" --env test-bot
go run ./scripts/verify iso crew --expect "started a new conversation" -- mate new test-codex "TEST hi"
go run ./scripts/verify iso dump codex --has CODEX_HOME={home}/envs/test-bot/codex --has OPENAI_API_KEY=sk-TEST-openai-key --has GH_TOKEN=TEST-gh-token --has CLAUDE_CONFIG_DIR={home}/envs/test-bot/claude --unset SSH_AUTH_SOCK --unset CREW_E2E
go run ./scripts/verify iso file {home}/envs/test-bot/codex/hooks.json --expect "crew hook"
go run ./scripts/verify iso panes --expect "env exec test-bot -- codex"
go run ./scripts/verify iso crew -- mate set test-omp --agent omp --prompt "TEST omp prompt" --env test-bot
go run ./scripts/verify iso crew --expect "started a new conversation" -- mate new test-omp "TEST hi"
go run ./scripts/verify iso dump omp --has PI_CODING_AGENT_DIR={home}/envs/test-bot/omp --has GEMINI_API_KEY=TEST-gemini-key --has CODEX_HOME={home}/envs/test-bot/codex --unset SSH_AUTH_SOCK --unset CREW_E2E
go run ./scripts/verify iso file {home}/envs/test-bot/omp/hooks/post/crew.ts --expect "crew"
go run ./scripts/verify iso panes --expect "env exec test-bot -- omp"
```

### a resume of a custom mate applies the environment again

```sh
go run ./scripts/verify iso dump --clear
sid=$(go run ./scripts/verify iso crew -- mate new test-mate "TEST resume" | grep -o 'session [0-9a-f]*' | head -n 1 | cut -d' ' -f2) && go run ./scripts/verify iso dump claude && go run ./scripts/verify iso api POST "/api/v1/sessions/$sid/end" && go run ./scripts/verify iso dump --clear && go run ./scripts/verify iso api POST "/api/v1/sessions/$sid/resume"
go run ./scripts/verify iso dump claude --has CLAUDE_CONFIG_DIR={home}/envs/test-bot/claude --has CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-TEST-claude-token --unset SSH_AUTH_SOCK
go run ./scripts/verify iso panes --expect "env exec test-bot -- claude --resume TEST-"
```

### personal HOME files stay byte-identical

The setup saves the checksum before any mate starts. The recipes before this one start and resume mates on `test-bot`.

```sh
go run ./scripts/verify iso homesum --check before
```

### the local environment does not change the launch

A mate with no `env` starts with no `crew env exec` and with the environment of the daemon. A mate on `--env local` with no extra variables gets the same environment.

```sh
go run ./scripts/verify iso dump --clear
go run ./scripts/verify iso crew -- mate set test-plain --agent claude --prompt "TEST plain prompt"
go run ./scripts/verify iso crew --expect "started a new conversation" -- mate new test-plain "TEST hi"
go run ./scripts/verify iso dump claude --save plain --has SSH_AUTH_SOCK={home}/TEST-ssh-agent.sock --has CLAUDE_CONFIG_DIR={home}/home/.claude --has CREW_E2E={home}/e2e --unset GIT_CONFIG_GLOBAL --unset GH_CONFIG_DIR
go run ./scripts/verify iso panes --start 'claude --append-system-prompt "TEST plain prompt'
go run ./scripts/verify iso dump --clear
go run ./scripts/verify iso crew -- mate set test-local --agent claude --prompt "TEST plain prompt" --env local
go run ./scripts/verify iso crew --expect "started a new conversation" -- mate new test-local "TEST hi"
go run ./scripts/verify iso dump claude --same plain --ignore CREW_ARGV --ignore TMUX_PANE --ignore PWD --ignore OLDPWD
```

### no TEST value in ps, logs or answers

```sh
go run ./scripts/verify iso leaks sk-ant-oat01-TEST-claude-token --api /api/v1/envs --api /api/v1/envs/test-bot --api /api/v1/mates
go run ./scripts/verify iso leaks TEST-gh-token --api /api/v1/envs --api /api/v1/envs/test-bot --api /api/v1/mates
go run ./scripts/verify iso leaks sk-TEST-openai-key --api /api/v1/envs --api /api/v1/envs/test-bot --api /api/v1/mates
go run ./scripts/verify iso leaks TEST-gemini-key --api /api/v1/envs --api /api/v1/envs/test-bot --api /api/v1/mates
```

### delete is refused while a mate uses the environment

```sh
{ go run ./scripts/verify iso crew -- env delete test-bot || true; } | grep -q 'environment test-bot is used by mate test-mate'
go run ./scripts/verify iso api DELETE /api/v1/envs/test-bot --status 409 --expect '"code":"in_use"' --expect test-mate
go run ./scripts/verify iso crew --expect test-bot -- env list
go run ./scripts/verify iso crew -- env create test-spare --kind custom --part github
go run ./scripts/verify iso crew -- env delete test-spare
go run ./scripts/verify iso crew --absent test-spare -- env list
```

### a new SSH key waits for confirm or cancel

```sh
go run ./scripts/verify iso crew --expect "new key, not in use yet" -- env ssh-key test-bot --rotate
go run ./scripts/verify iso crew --expect "new ssh key, not in use yet" -- env show test-bot
go run ./scripts/verify iso api GET /api/v1/envs/test-bot --expect '"new_public_key":"ssh-ed25519 '
go run ./scripts/verify web drive /#/envs/test-bot --viewport desktop --out-dir /tmp/crew-verify-map/environments --steps '[{"expect":{"text":"New ed25519 key"}},{"shot":"ssh-new-key.png"},{"click":{"role":"button","name":"Cancel new key"}},{"expect":{"text":"New ed25519 key"},"absent":true}]'
go run ./scripts/verify iso api GET /api/v1/envs/test-bot --absent new_public_key
go run ./scripts/verify iso crew -- env ssh-key test-bot --rotate
go run ./scripts/verify web drive /#/envs/test-bot --viewport desktop --out-dir /tmp/crew-verify-map/environments --steps '[{"click":{"role":"button","name":"I added it to GitHub"}},{"expect":{"text":"New ed25519 key"},"absent":true},{"shot":"ssh-confirmed.png"}]'
go run ./scripts/verify iso api GET /api/v1/envs/test-bot --absent new_public_key
```

### PWA Environments page shows names and "set" only

```sh
go run ./scripts/verify web drive /#/envs --viewport both --out-dir /tmp/crew-verify-map/environments --steps '[{"expect":{"text":"test-bot"}},{"shot":"envs.png"}]'
go run ./scripts/verify web drive /#/envs/test-bot --viewport both --out-dir /tmp/crew-verify-map/environments --steps '[{"expect":{"role":"group","name":"GitHub token"}},{"expect":{"role":"group","name":"Claude"}},{"expect":{"role":"group","name":"Codex"}},{"expect":{"role":"group","name":"Pi"}},{"expect":{"text":"set","exact":true}},{"expect":{"text":"sk-ant-oat01-TEST-claude-token","exact":false},"absent":true},{"expect":{"text":"TEST-gh-token","exact":false},"absent":true},{"expect":{"text":"sk-TEST-openai-key","exact":false},"absent":true},{"expect":{"text":"TEST-gemini-key","exact":false},"absent":true},{"shot":"env-test-bot.png"}]'
```

### PWA mate picker selects an environment

```sh
go run ./scripts/verify iso crew -- mate set test-pick --agent claude --prompt "TEST pick prompt"
go run ./scripts/verify web drive /#/mates/test-pick --viewport desktop --out-dir /tmp/crew-verify-map/environments --steps '[{"click":{"role":"combobox","name":"Environment"}},{"click":{"role":"option","name":"test-bot"}},{"expect":{"text":"Isolated: its own git identity","exact":false}},{"shot":"mate-env-picker.png"}]'
go run ./scripts/verify iso crew --expect "env:     test-bot" -- mate show test-pick
```

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- A custom environment applies all its parts to each harness. Thus a `claude` mate on `test-bot` also gets `CODEX_HOME` and `OPENAI_API_KEY`.
- The Environments page shows a set or not-set state for each part (GitHub token, Claude, Codex, Pi), not the variable names. `crew env show` and `GET /api/v1/envs/{name}` show the variable names.
- Use only TEST values. Never put a real token in the isolated crew.
- Environment names allow only lower case letters, digits, `-` and `_`. Use the `test-` prefix.
- `crew env exec` replaces itself with the agent (`syscall.Exec`). Thus `ps` shows the agent, and the tmux pane start command shows `crew env exec <env> --`. `iso panes` reads the pane start commands.
- `iso leaks` skips the lines of `ps` that contain `iso leaks `, because its own arguments contain the text.
