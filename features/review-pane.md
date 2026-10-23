# Review pane

The Review tab of a session in the app shows the local, PR-style review: the scope tabs (`last turn`, `uncommitted`, `branch vs base`), the worktree tabs, the file tree and the diff.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### diff, comments and send on a real repo (manual: the seeded worktrees are not repos; the review needs a session on a temp repo with changes, see internal/adapters/git tests)

### crew review comment, scope and send from the CLI (manual: it needs a real repo diff and a live harness to receive the send)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The seeded worktrees under `/tmp/seed` are not git repos. Thus every scope shows `no changes`.
