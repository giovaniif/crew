# nvim

`e` toggles nvim on the worktree of the selected session. In the review, `o` opens the top visible line of the diff in nvim. The Lua plugin is in `nvim/`.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### the help lists the nvim key

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/nvim --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"?"},{"expect":"nvim (o in a review opens the line)","timeout":3000}]'
```

### CrewDiff completes only the scopes that start with the typed text

```sh
nvim --clean --headless -c "set rtp^=$PWD/nvim" -c 'runtime plugin/crew.lua' -c 'lua if not vim.deep_equal(vim.fn.getcompletion("CrewDiff b", "cmdline"), { "branch" }) then os.exit(1) end' -c 'qa!'
```

### CrewComment refuses the old side of a diff before it calls crew

```sh
CREW_SESSION=TEST-s nvim --clean --headless -c "set rtp^=$PWD/nvim" -c 'runtime plugin/crew.lua' -c 'lua local m = "" vim.notify = function(x) m = x end require("crew").setup({ bin = "false", navigate = false }) vim.api.nvim_buf_set_name(0, "diffview:///tmp/TEST/.git/abc/a.lua") vim.cmd("1CrewComment hi") if not m:find("working-tree side", 1, true) then os.exit(1) end' -c 'qa!'
```

### e opens nvim in the slot (manual: the seeded worktrees do not exist on disk, and the TUI runs alone, not in the crew client layout)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- `verify tui` runs `crew tui` in a plain tmux session, not in the client layout. Keys that swap panes into the slot (`enter`, `t`, `e`) need `make dev`.
