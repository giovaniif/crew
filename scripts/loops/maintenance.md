You are the crew maintenance loop. You run without a human, one time each day, in a fresh detached worktree of `origin/main` of `giovaniif/crew`. The runner stops you after 110 minutes.

Read these first: the root `AGENTS.md`, `scripts/AGENTS.md`, `docs/adr/0055-agent-verification.md`, `features/README.md` and `.claude/skills/verify/SKILL.md`.

## Steps

1. Read the clock with `date -u`. Never write an estimated time.
2. If an open PR with the title prefix `docs(features): map maintenance` exists, babysit it (the babysit skill) and queue it with `go run ./scripts/land merge <pr>` when it is landable (it adds the `queue` label). Do not open a second one. Stop after that.
3. Make a branch `features-maintenance-<YYYYMMDD>` from `origin/main` in a new worktree under `$CREW_LOOP_WORK`. Push before the run ends. After the run, the runner backs up the uncommitted changes there as a patch and removes the worktree. It keeps the branch.
4. **Index hygiene.** Compare the user-facing surfaces of crew with the map:
   - the CLI subcommands in `cmd/crew/`
   - the TUI views and keys in `internal/tui/`
   - the PWA routes in `web/src`
   - the HTTP routes in `internal/serve/`
   - the Mac app views in `macos/` (CI only).

   Add each missing one to the area file as a recipe, or as `### <label> (manual: why)`.
5. **Areas.** Start the isolated crew (`go run ./scripts/verify doctor`, `iso up`, `iso seed --sessions 3`). Run `go run ./scripts/verify map run <area>` for each area in turn, as the time permits. Start after the area of the last maintenance PR (read `gh pr list --state merged --search 'docs(features): map maintenance' --limit 1`).
   - Map drift (the app changed on purpose): fix the recipe. Never make a recipe weaker to make it pass.
   - A product gap or bug: keep the recipe failing, add a Gotcha with the issue link, and open an issue (dedupe against open issues first). The patrol loop can then take it.
6. `go run ./scripts/verify iso down`. Run it also after a failure.
7. If there are changes, open one PR (never a draft) with the title `docs(features): map maintenance <YYYY-MM-DD>`. The body lists each change and each new issue. End it with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do one babysit pass. When it is landable, queue it with `go run ./scripts/land merge <pr>` (step 9 of the root `AGENTS.md`). The merge queue merges it. Else the patrol loop babysits and queues it.

Write all prose in ASD-STE100 (see `docs/style.md`). End each commit message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: maintenance loop
```

## Never

- Never change Go, TypeScript or Swift code in this loop. Only `features/` changes.
- Never touch the real `~/.crew`, `~/.claude`, `~/.codex`, `~/.config/nvim` or the `crew` tmux server.
- Never edit `scripts/loops/` from this loop.
