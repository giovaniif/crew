# internal/app

Use cases and the ports they need. This package depends only on `domain`. Tests use in-memory fakes of the ports in `fakes_test.go` / `*_fake_test.go`. CI runs `gremlins` here (≥ 80%).

- **Use cases:** `Sessions` (start and end), `ScanWorktrees`, `RefreshPRs`, `Cleanup` (plan and execute), `Reviewer`, `SnapshotTurn`/`DropTurns`, `ApplyHunk`, `SendPrompt`, `SendSwitches`, `DiscoverWorkspace`, `RefreshRepoFacts`, `ReconcilePanes`, `WorktreeSetup`, `DiskSizes`, `Transcripts` (`Page`, `Tail`, `TranscriptTail.Read`/`Since`).
- **Ports:** `TerminalHost`, `HarnessAdapter`, `Store`, `Notifier`, `Foreground`, `ProcessTable`, `WorkspaceFS`, `RepoInspector`, `WorktreeAdder`, `WorktreeLister`, `PRFinder`, `TitleResolver`, `ReviewGit`, `HunkGit`, `CleanupGit`, `WorktreeHolders`, `Trash`, `CleanupAudit`, `Sizer`, `Editor`, `Onboarder`, `TranscriptFiles`, `TranscriptWatcher`, `TranscriptParser`. For setup recipes: `RecipeSource`, `MainCheckouts`, `SetupFS`, `CommandRunner`. When a port changes, update the `-tags integration` fakes too.
- **Harnesses.** `HarnessAdapter` changes a `LaunchRequest` into the `PaneSpec` that runs the harness. Hooks use the `$TMUX_PANE` of the pane to find the session again.

## Cleanup execution

`app.Cleanup` does these steps:

1. It makes the plan.
2. It backs up `backup_then_ask` worktrees under `$CREW_HOME/backups/<ts>/<name>/`.
3. It checks lsof and the git facts again.
4. It renames `remove` worktrees into `$CREW_HOME/trash/`.
5. It runs `git worktree prune` for each repo. A `prune` worktree (the folder is gone) gets only this step. Nothing moves to the trash.
6. A `forget` worktree (the repo and the folder are gone) gets the outcome `forgotten`, and the daemon drops its row. An `orphan` worktree (only the repo is gone) stays.

`RemoveWorktree` with a backup on an `orphan` puts the whole folder in `folder.tar` in the backup dir (`BackupFolder`). Then it checks lsof and the facts again, and moves the folder to the trash only when it is still an `orphan`.

A background job empties the trash, 4 at a time. Cleanup never deletes branches. A detached HEAD with commits that are not in the default branch first gets `backup/wt-<name>`. `RemoveWorktree` does the `d`/`b` of the disk view. Each change here needs tests for the never-destroy cases in the root rules. See [ADR 0021](../../docs/adr/0021-worktree-cleanup.md).

## Disk sizes

`app.DiskSizes.Get` never waits. `du` runs in a pool of 2, and its results stay in a cache for 5 min. If the folder is not on disk (`fs.ErrNotExist`), the size is `domain.SizeMissing`, a final value. Nothing on the loop, the render path or a request waits for it. See [ADR 0030](../../docs/adr/0030-worktrees-disk-view.md).
