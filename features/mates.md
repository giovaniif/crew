# Mates

A mate is an agent that answers in Slack. `crew mate set` adds one, `crew mate tokens` stores its Slack tokens, `crew mate claim` links its owner. The isolated crew has blank Slack tokens, so a mate never connects.

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

### a run of a linked automation shows as a mate thread with the tag Automation

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
H="$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")"
go run ./scripts/verify iso crew -- mate set test-ada --agent claude --prompt "TEST role prompt" --repo TEST-live
printf '\n[[automation]]\nname = "test-weekly"\nmate = "test-ada"\nprompt = "TEST weekly check"\n' >> "$H/config.toml"
go run ./scripts/verify iso crew --expect test-weekly -- automation list --mate test-ada
go run ./scripts/verify iso crew --expect succeeded -- automation run test-weekly
{ go run ./scripts/verify iso crew -- mate remove test-ada || true; } | grep -q 'used by automation test-weekly'
go run ./scripts/verify web drive /#/mates/test-ada --viewport desktop --out-dir /tmp/crew-verify-map/mates --steps '[{"expect":{"text":"Automation","exact":true},"timeout":10000},{"expect":{"text":"test-weekly","exact":false}},{"shot":"automation-thread.png"}]'
```

Expect: the thread list of `test-ada` has the run with the tag Automation, the rail lists `test-weekly`, and `mate remove` refuses the mate while the automation names it. The fake `claude` of `iso up --session` runs the session.

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
