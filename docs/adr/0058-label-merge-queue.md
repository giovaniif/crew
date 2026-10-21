# ADR 0058: A merge queue with a label

Status: accepted, 2026-10-20.

## Context

Branch protection of `main` requires `build`, `tdd` and `mutate`, and a branch that is up to date with `main`. Many agents work in parallel. Each agent updated the branch of its PR with `update-branch` and then merged it. When one PR merged, all other PRs were behind again. The agents then called `update-branch` at the same time. Each new update started CI again and cancelled the CI of the last update. Thus few PRs merged, and CI time was lost.

The native GitHub merge queue solves this problem. It is not available for a repository that a user owns. This repository is user-owned.

## Decision

We use a merge queue with a label.

- An agent does not merge its PR and does not call `update-branch`.
- When `build`, `tdd` and `mutate` are green on its PR, the agent adds the `queue` label. A branch that is behind `main` is fine.
- The service `crew-merge-queue` on the dev box processes the open PRs with the `queue` label, oldest first, one at a time:
  - If the PR is behind `main`, it calls `update-branch` and waits.
  - When `build`, `tdd` and `mutate` are green (and `desktop`, `desktop-macos` and `macos` when they ran), it merges the PR with a merge commit.
  - On a conflict, a draft or a failed check, it removes the label and comments why. The agent fixes the cause and adds the label again.
- `go run ./scripts/land merge <pr>` adds the `queue` label and reports `queued`. It does not merge.
- Branch protection does not change.

## Consequences

- Only one process calls `update-branch`, thus CI runs are not cancelled.
- PRs merge one at a time. A queue of many PRs takes more time, but each merge is safe.
- The merge queue depends on the dev box. If the service stops, labelled PRs wait. They do not merge.
