# Worktrees and cleanup

crew tracks each worktree with its repo, branch, PR and session. Cleanup removes a worktree after its PR merges. It backs up uncommitted changes first, never deletes branches, and never touches a worktree that a process uses. `crew cleanup --dry-run` only reports what it would do. `crew cleanup` with no flag runs the cleanup.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### worktree list shows the seeded worktrees and PRs

```sh
go run ./scripts/verify iso crew --expect seed-1-api --expect "#100 OPEN failing" --expect seed-3-infra -- worktree list
```

### seeded worktrees name their session (#450)

```sh
go run ./scripts/verify iso crew --expect seed-session-1 --absent unassigned -- worktree list
```

### cleanup dry run keeps worktrees it cannot read

```sh
go run ./scripts/verify iso crew --expect "keep" --expect "kept" --expect "its session is live" --absent "removed" -- cleanup --dry-run
```

Expect: each seeded worktree is `keep` with `its session is live`, because each seeded session is live. The live-session rule comes before the facts of the folder.

### cleanup of a merged worktree on a temp repo (manual: needs a temp repo with a merged PR in the fake gh; the rules are in internal/domain cleanup tests and internal/app tests)

### crew setup-worktree runs the .crew.toml recipe (manual: it needs a repo with a .crew.toml setup recipe)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Do not run `d` or `b` in the disk view on a real repo. They really remove worktrees.
