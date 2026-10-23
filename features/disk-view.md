# Disk view

The Disk screen of the app (`/#/disk`) shows the volume, the worktree total, the reclaimable total, the auto-cleanup interval, one row for each worktree and the recently cleaned list. The daemon measures sizes in a worker. A size in measurement shows `…`.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### the Disk screen lists every worktree (manual: no app recipe yet; the TUI recipes were removed with the TUI, see [ADR 0062](../docs/adr/0062-remove-the-tui.md))

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never remove or back up a real repo from this screen.
- The seeded worktrees do not exist on disk, so their sizes show `missing` ([#417](https://github.com/giovaniif/crew/issues/417), fixed).
- RECENTLY CLEANED reads `cleanup.log`. An entry that is not from today shows its date ([#593](https://github.com/giovaniif/crew/issues/593), fixed). No recipe: map recipes do not get the `CREW_HOME` of the isolated crew, so they cannot add an old entry. `TestWorktreesRecentlyCleanedShowsTheDateOfAnOlderCleanup` covers it.
