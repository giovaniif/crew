# Mates

A mate is an agent that answers in Slack and in the app. It has one conversation: all input goes into it, and each answer goes back to where the message came from (ADR [0064](../docs/adr/0064-one-conversation-per-mate.md)). `crew mate set` adds one, `crew mate tokens` stores its Slack tokens, `crew mate claim` links its owner. The isolated crew has blank Slack tokens, so a mate never connects.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
```

## Recipes

### empty state tells how to add one

```sh
go run ./scripts/verify iso crew --expect "no mates" -- mate list
```

### add, show and remove a TEST mate

```sh
go run ./scripts/verify iso crew -- mate set test-mate --agent claude --prompt "TEST prompt"
go run ./scripts/verify iso crew --expect test-mate --expect claude -- mate list
go run ./scripts/verify iso crew --expect "TEST prompt" -- mate show test-mate
go run ./scripts/verify iso crew -- mate remove test-mate
go run ./scripts/verify iso crew --expect "no mates" -- mate list
```

### a mate answers in a Slack thread (manual: needs a real Slack workspace and tokens; the isolated crew blanks them)

### Slack mentions, DMs and app input share one conversation, and each answer goes back to its thread (the fake Slack of the daemon tests)

```sh
go test ./internal/daemon/ -count=1 -run 'MateMentionsInTwoSlackThreads|MateDirectMessageGoesToTheConversation|AnswersInTheThreadOfEachTurnInOrder|SlackTurnInAnAppConversationGoesThroughTheGate'
```

Expect: `ok`. The isolated crew has no Slack, so the fakes of the daemon tests drive these flows.

### PWA Mates tab opens at both viewports

```sh
go run ./scripts/verify web drive / --viewport both --out-dir /tmp/crew-verify-map/mates --steps '[{"click":{"role":"link","name":"Mates"}},{"expect":{"role":"link","name":"Mates"}},{"shot":"mates.png"}]'
```

### PWA New mate refuses the name of a mate that exists

```sh
go run ./scripts/verify iso crew -- mate set test-taken --agent claude --prompt "TEST original prompt"
go run ./scripts/verify web drive /#/mates/new --viewport both --out-dir /tmp/crew-verify-map/mates --steps '[{"fill":{"label":"Name"},"value":"test-taken"},{"expect":{"text":"A mate named test-taken exists."}},{"shot":"new-mate-taken.png"}]'
go run ./scripts/verify iso crew --expect "TEST original prompt" -- mate show test-taken
go run ./scripts/verify iso crew -- mate remove test-taken
```

### a run of a linked automation shows in the conversation with the tag Automation

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
go run ./scripts/verify iso crew -- mate set test-ada --agent claude --prompt "TEST role prompt" --repo TEST-live
printf '\n[[automation]]\nname = "test-weekly"\nmate = "test-ada"\nprompt = "TEST weekly check"\n' >> "$(jq -r .home "$VERIFY_HOME/iso.json")/config.toml"
go run ./scripts/verify iso crew --expect test-weekly -- automation list --mate test-ada
go run ./scripts/verify iso crew --expect succeeded -- automation run test-weekly
{ go run ./scripts/verify iso crew -- mate remove test-ada || true; } | grep -q 'used by automation test-weekly'
go run ./scripts/verify web drive /#/mates/test-ada --viewport desktop --out-dir /tmp/crew-verify-map/mates --steps '[{"expect":{"text":"Automation","exact":true},"timeout":10000},{"expect":{"text":"test-weekly","exact":false}},{"shot":"automation-thread.png"}]'
```

Expect: the conversation of `test-ada` has the run with the tag Automation, the rail lists `test-weekly`, and `mate remove` refuses the mate while the automation names it. The fake `claude` of `iso up --session` runs the session.

### a run of an omp mate keeps its pane

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
go run ./scripts/verify iso crew -- mate set test-pi --agent omp --prompt "TEST role prompt" --repo TEST-live
printf '\n[[automation]]\nname = "test-pi-check"\nmate = "test-pi"\nprompt = "TEST pi check"\n' >> "$(jq -r .home "$VERIFY_HOME/iso.json")/config.toml"
go run ./scripts/verify iso crew --expect succeeded -- automation run test-pi-check
sleep 2
go run ./scripts/verify iso panes --expect omp
```

Expect: the pane of the omp mate is open 2 s after the run starts. The fake `omp` of `iso up` reads `$CREW_E2E/omp.steps` and holds its pane.

### the first message to a mate starts its conversation and shows in the chat

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
printf 'run sh %s/features/testdata/mate-chat.sh\n' "$PWD" >"$(jq -r .home "$VERIFY_HOME/iso.json")/e2e/claude.steps"
go run ./scripts/verify iso crew -- mate set test-ux --agent claude --prompt "TEST role prompt" --repo TEST-live
go run ./scripts/verify web drive /#/mates/test-ux --viewport desktop --out-dir /tmp/crew-verify-map/mates --steps '[{"expect":{"label":"Message"},"timeout":10000},{"wait":2000},{"fill":{"label":"Message"},"value":"TEST first check"},{"press":"Enter"},{"expect":{"text":"TEST first check","exact":true},"timeout":3000},{"shot":"mate-thread-sent.png"},{"expect":{"text":"TEST reply: TEST first check"},"timeout":20000},{"shot":"mate-thread-reply.png"}]'
```

Expect: the sent text shows at once, and the reply comes in by the stream. The fake `claude` sends hooks with no `transcript_path`, as a Claude with no crew hooks in `settings.json` does not tell crew the path. The script is `features/testdata/mate-chat.sh`. It writes the transcript where Claude writes it: `$CLAUDE_CONFIG_DIR/projects/<dir>/<--session-id>.jsonl`.

### app messages and automation runs go into one conversation, and start fresh begins a new one

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
go run ./scripts/verify iso crew -- mate set test-one --agent claude --prompt "TEST role prompt" --repo TEST-live
printf '\n[[automation]]\nname = "test-one-check"\nmate = "test-one"\nprompt = "TEST check"\n' >> "$(jq -r .home "$VERIFY_HOME/iso.json")/config.toml"
go run ./scripts/verify iso crew -- mate new test-one TEST first ask | grep -o 'session [0-9a-f]*' > "$VERIFY_HOME/one-first"
go run ./scripts/verify iso crew -- mate new test-one TEST second ask | grep -o 'session [0-9a-f]*' > "$VERIFY_HOME/one-second"
grep -q session "$VERIFY_HOME/one-first" && cmp "$VERIFY_HOME/one-first" "$VERIFY_HOME/one-second"
go run ./scripts/verify iso crew --expect succeeded -- automation run test-one-check
go run ./scripts/verify iso crew -- automation runs test-one-check | grep -q "$(cut -d' ' -f2 "$VERIFY_HOME/one-first")"
go run ./scripts/verify iso crew --expect "fresh conversation" -- mate reset test-one
go run ./scripts/verify iso crew -- mate new test-one TEST third ask | grep -o 'session [0-9a-f]*' > "$VERIFY_HOME/one-third"
grep -q session "$VERIFY_HOME/one-third" && ! cmp -s "$VERIFY_HOME/one-first" "$VERIFY_HOME/one-third"
```

Expect: the two app messages and the automation run use one session. After `mate reset`, the next message starts a new session, and the old one stays as history.

### a help flag in the place of the name prints the usage

```sh
{ go run ./scripts/verify iso crew -- mate show --help || true; } | grep -q 'usage: crew mate'
{ go run ./scripts/verify iso crew -- mate set -h || true; } | grep -q 'usage: crew mate'
{ go run ./scripts/verify iso crew -- mate set test-help --help || true; } | grep -q 'usage: crew mate'
```

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never put real Slack tokens in the isolated crew.
- Mate names allow only lower case letters, digits, `-` and `_`. Use the `test-` prefix for mates, not `TEST-`.

## Environments

A mate can use an environment (`crew mate set <name> --env <env>`). See [environments.md](environments.md) and ADR [0061](../docs/adr/0061-environments-for-mates.md).
