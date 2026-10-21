# PR board

`crew pr <session>` shows the PRs of a session: the blockers (failing checks, requested changes, open threads), the failing checks with links, and the bot comments since the last push. `--json` gives the same data for agents.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### PR board of the first seeded session

```sh
go run ./scripts/verify iso crew --expect "#100" --expect "checks failing" --expect "unit tests" --expect "bot comments since push: 3" -- pr seed-session-1
```

### PR board as JSON

```sh
go run ./scripts/verify iso crew --expect '"number"' --expect '100' -- pr seed-session-1 --json
```

### a PR with no blockers is ready to merge (#591)

```sh
go run ./scripts/verify iso crew --expect "#101  seeded change 2  https://example.com/pull/101" --expect "ready to merge" -- pr seed-session-2
```

### unknown session fails

```sh
sh -c '! go run ./scripts/verify iso crew -- pr TEST-no-such-session >/dev/null'
```

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The PR data comes from the seed, not from GitHub. The fake `gh` on `PATH` answers `gh api` with `$CREW_E2E/prs.json`.
- The seed gives each repo of a session its own PR numbers, and the fake `gh` cannot make a fork PR. Thus the map cannot show two repos with the same PR number (#497) or a fork PR that has the name of a local branch (#499). Unit tests cover them.
