# Review pane

`r` opens the local, PR-style review of the selected session. The sidebar widens, the list becomes a rail, and the review shows the scope tabs (`last turn`, `uncommitted`, `branch vs base`), the worktree tabs, the file tree and the diff. `r` or `esc` closes it.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### r opens the review with scopes and worktrees

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/review --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"r"},{"expect":"REVIEW","timeout":5000},{"expect":"last turn"},{"expect":"branch vs base"},{"expect":"api:part-1"},{"shot":"review.png"}]'
```

Expect: the rail on the left, the transcript of the session, and `0 files` for the seeded worktrees.

### esc closes the review

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/review --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"r"},{"expect":"REVIEW","timeout":5000},{"keys":"Escape"},{"absent":"REVIEW","timeout":5000},{"expect":"SESSIONS"}]'
```

### ] changes the scope

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/review --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"r"},{"expect":"REVIEW","timeout":5000},{"keys":"]"},{"wait":800},{"shot":"scope.png"}]'
```

### a draft card shows its whole hint in the narrow agent column

```sh
for d in api-2 web-2; do rm -rf /tmp/seed/$d && mkdir -p /tmp/seed/$d && git -C /tmp/seed/$d init -q -b main && printf 'package main\n' > /tmp/seed/$d/main.go && git -C /tmp/seed/$d add . && git -C /tmp/seed/$d -c user.email=t@t -c user.name=t commit -qm TEST-init && printf 'package main\n\nfunc TEST() {}\n' > /tmp/seed/$d/main.go; done
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/review --steps '[{"expect":"seeded change 1","timeout":8000},{"keys":"r"},{"expect":"REVIEW","timeout":5000},{"wait":1200},{"keys":"j"},{"keys":"c"},{"wait":400},{"type":"TEST- note"},{"keys":"Enter"},{"expect":"Draft review","timeout":4000},{"expect":"one prompt"},{"shot":"draft.png"}]'
```

Expect: the card under the agent column ends with `sent as one prompt` on its own line, never a bare `sent` (#491).

### diff, comments and send on a real repo (manual: the seeded worktrees are not repos; the review needs a session on a temp repo with changes, see internal/adapters/git tests)

### crew review comment, scope and send from the CLI (manual: it needs a real repo diff and a live harness to receive the send)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The seeded worktrees under `/tmp/seed` are not git repos. Thus every scope shows `no changes`. The draft card recipe makes `api-2` and `web-2` into temp repos first.
