# nvim

The Editor tab of a session in the app runs nvim on its worktree. The Lua plugin is in `nvim/`.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### CrewDiff completes only the scopes that start with the typed text

```sh
nvim --clean --headless -c "set rtp^=$PWD/nvim" -c 'runtime plugin/crew.lua' -c 'lua if not vim.deep_equal(vim.fn.getcompletion("CrewDiff b", "cmdline"), { "branch" }) then os.exit(1) end' -c 'qa!'
```

### CrewComment refuses the old side of a diff before it calls crew

```sh
CREW_SESSION=TEST-s nvim --clean --headless -c "set rtp^=$PWD/nvim" -c 'runtime plugin/crew.lua' -c 'lua local m = "" vim.notify = function(x) m = x end require("crew").setup({ bin = "false", navigate = false }) vim.api.nvim_buf_set_name(0, "diffview:///tmp/TEST/.git/abc/a.lua") vim.cmd("1CrewComment hi") if not m:find("working-tree side", 1, true) then os.exit(1) end' -c 'qa!'
```

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The seeded worktrees do not exist on disk. Thus nvim on a seeded session opens an empty folder.
