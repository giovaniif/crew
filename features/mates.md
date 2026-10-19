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

### C opens the mates and approvals view in the TUI

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/mates --steps '[{"expect":"SESSIONS","timeout":8000},{"keys":"C"},{"expect":"MATES"},{"expect":"APPROVALS"},{"shot":"tui-mates.png"},{"keys":"Escape"}]'
```

### PWA Mates tab opens at both viewports

```sh
go run ./scripts/verify web drive / --viewport both --out-dir /tmp/crew-verify-map/mates --steps '[{"click":{"role":"link","name":"Mates"}},{"expect":{"role":"link","name":"Mates"}},{"shot":"mates.png"}]'
```

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never put real Slack tokens in the isolated crew.
- Mate names allow only lower case letters, digits, `-` and `_`. Use the `test-` prefix for mates, not `TEST-`.
