# Disk view

`w` opens WORKTREES & DISK. It shows the volume, the worktree total, the reclaimable total, the auto-cleanup interval, one row for each worktree and the recently cleaned list. Sizes are measured off the render path. A size in measurement shows `…`.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### w opens the disk view with every worktree

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"seed-1-api"},{"expect":"seed-3-infra"},{"expect":"Auto-cleanup every"},{"expect":"RECENTLY CLEANED"},{"shot":"disk.png"}]'
```

### sizes finish measuring

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"absent":"…","timeout":30000},{"shot":"sizes.png"}]'
```

Expect: after the first refresh, no row shows `…` and the worktree total has no `+`.

### esc closes the disk view

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"keys":"Escape"},{"absent":"WORKTREES & DISK","timeout":5000}]'
```

### an 80-column terminal shows the full branch and no empty PORT column

```sh
go run ./scripts/verify tui drive --restart --size 80x30 --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"seed-3-infra","timeout":5000},{"absent":"PORT"}]'
```

### a 60-column terminal keeps the SIZE column

```sh
go run ./scripts/verify tui drive --restart --size 60x20 --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"SIZE","timeout":5000},{"expect":"KB","timeout":8000}]'
```

### an 18-row terminal keeps the footer and the status line

```sh
go run ./scripts/verify tui drive --restart --size 100x18 --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"seed-1-api","timeout":5000},{"expect":"w or esc closes","timeout":5000},{"keys":"k"},{"expect":"no dev servers in this worktree","timeout":5000}]'
```

### a short terminal says how many worktree rows it hides

```sh
go run ./scripts/verify iso seed --sessions 12
go run ./scripts/verify tui drive --restart --size 90x20 --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"more","timeout":5000},{"expect":"w or esc closes"}]'
```

Expect: under the last row that fits, `… N more` counts the rows that are cut ([#689](https://github.com/giovaniif/crew/issues/689)).

### numbered worktrees are listed in number order

```sh
go run ./scripts/verify iso seed --sessions 12
go run ./scripts/verify tui drive --restart --size 90x20 --out-dir /tmp/crew-verify-map/disk --steps '[{"expect":"seeded change","timeout":8000},{"keys":"w"},{"expect":"WORKTREES & DISK","timeout":5000},{"expect":"seed-2-api","timeout":5000},{"absent":"seed-10-api"}]'
```

Expect: `seed-2-api` comes right after `seed-1-api`, and `seed-10-api` is below the cut ([#691](https://github.com/giovaniif/crew/issues/691)).

### disk view keys k, o and g (manual: they act on real worktree folders)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Never press `d` or `b` here on real repos.
- The seeded worktrees do not exist on disk, so their sizes show `missing` ([#417](https://github.com/giovaniif/crew/issues/417), fixed).
- RECENTLY CLEANED reads `cleanup.log`. An entry that is not from today shows its date ([#593](https://github.com/giovaniif/crew/issues/593), fixed). No recipe: map recipes do not get the `CREW_HOME` of the isolated crew, so they cannot add an old entry. `TestWorktreesRecentlyCleanedShowsTheDateOfAnOlderCleanup` covers it.
