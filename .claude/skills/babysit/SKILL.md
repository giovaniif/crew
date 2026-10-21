---
name: babysit
description: Drive one crew PR to ready. Fix CI, run the land gate, then add the `queue` label. Use it when asked to babysit, watch or get a PR green in giovaniif/crew.
---

# Babysit a crew PR

One agent for each PR, in its own worktree. Never babysit in a worktree that you edit for another change.

## Ready means

- The required checks of `main` are green on the PR head: `build`, `tdd` and `mutate`. Read them from branch protection, not from memory:

  ```sh
  gh api repos/giovaniif/crew/branches/main/protection --jq .required_status_checks.contexts
  ```

- No open review thread. `required_conversation_resolution` is on.
- A branch that is behind `main` is fine. The merge queue updates it.
- Then run `go run ./scripts/land check <pr>`.

## One pass

1. Read the state:

   ```sh
   gh pr view <pr> --json headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup,isDraft
   ```

2. **CI.** For each failing job, read the log (`gh run view <run> --log-failed`). Fix the cause. Push. Do not re-run a job to get a pass. A flaky test gets its own `test:` PR.
3. **TDD job.** The `tdd` job fails when:
   - a non-merge commit changes tests and production code together (`refactor:` commits and Markdown are exempt)
   - a new or changed test passes on the base branch.

   Fix the commit order (test commit first, then the code). Run `scripts/tdd-check origin/main HEAD` locally on a clean tree before you push.
4. **mutate.** It fails below 80% on `internal/domain` and `internal/app`. Add a test that kills the surviving mutants. Do not lower the bar.
5. **Behind main.** Do nothing. Do not call `update-branch`. The merge queue updates the branch of the PR that is first in the queue (ADR 0058).
6. **macOS jobs.** All `ci` jobs run on macOS runners. They are slow (15 to 30 min is normal). Wait. Do not cancel and re-run them.

## Gotchas

- `BLOCKED` with green checks almost always means an open thread. An update of the branch does not fix it.
- Removing a requested reviewer through the API can also remove team requests. Put them back.
- An approval can stay on an older head. Always compare the review commit with the head.
- Do not open draft PRs from a loop.
- When the PR is ready, run `go run ./scripts/land merge <pr>` (step 9 of the root `AGENTS.md`). It adds the `queue` label and reports `queued`. It does not merge. Do not merge the PR yourself. Do not wait for the owner. The owner examines the merged PRs in the daily review (`go run ./scripts/land digest --since 24h`).
- If the queue removes the `queue` label, it comments why (a conflict or a failed check). Fix the cause and run `land merge` again.
- Stacked PRs: when the base PR merges, GitHub changes the base to `main`. The queue then updates the branch.

## When ready

```sh
go run ./scripts/land check <pr>
```

Report the result. The verifier (a fresh agent) posts the verdict with `scripts/land verdict`.
