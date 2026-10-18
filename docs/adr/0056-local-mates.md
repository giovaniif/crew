# ADR 0056: Local mates, Slack as a connector, and mate memory

Status: accepted, 2026-10-18. Issue #435. This ADR amends [ADR 0053](0053-mates.md).

## Context

ADR 0053 makes each mate a Slack app. A mate without Slack tokens has the state `no_tokens`, and it can do no work. The owner wants to use mates in the crew app without Slack.

A long conversation fills the context window, and then the agent works less well. The owner wants to start a new conversation with the same mate at any time. The new conversation must keep the personality of the mate.

## Decision

### A mate is local first

- A mate is a named personality: `name`, `prompt`, `agent`, `model`, `effort` and `repos`. The `[[mate]]` table in `config.toml` does not change.
- `crew mate add <name> --agent claude --prompt "…"` makes a mate that works at once. It does not make a Slack manifest, and it does not ask for tokens.
- A mate without Slack tokens has the state `ready`, not `no_tokens`.
- Slack is an optional connector of a mate. The Slack setup is a separate step: `crew mate slack <name>` in the CLI, and "Connect to Slack…" in the PWA and the Mac app. This step does the manifest, the tokens and the claim of ADR 0053.

### A new conversation

- `crew mate new <name> [--repo r] [text]` and the RPC `mate.new` start a new conversation with a mate. The apps and the TUI have a "New conversation" button.
- A conversation is a normal session that `session.new` starts in its own worktree. The repo is `--repo`, or the first repo of the mate.
- The session gets the mate prompt as its system prompt: `--append-system-prompt` for Claude, and `developer_instructions` for Codex. It uses the model and the effort of the mate.
- The daemon records the mate name on the session. The sidebar shows the mate name.
- The owner starts a local conversation in the app. Thus a local conversation is owner-trusted, and the gate of ADR 0053 lets all actions run.

### Mate memory

- Each mate has a memory file `$CREW_HOME/mates/<name>/memory.md`.
- The system prompt of a new conversation has the mate prompt, then the memory file, then a short instruction. The instruction tells the mate the path of the file, and tells it to add short notes there: decisions, preferences of the owner and facts about the repos.
- The memory file has a limit of 8 KB. When the file is larger, the system prompt has only the last 8 KB, and the instruction tells the mate to make the file shorter.
- A pure function in `domain` makes the system prompt. It has table tests.
- The Mates page shows the memory. The owner can edit or clear it. The RPC methods are `mate.memory` and `mate.set_memory`.

### Start fresh

- "Start fresh" on a running mate session starts a new conversation of the same mate. The user can keep the same repo and worktree.
- First, the daemon sends a prompt to the old session. The prompt asks it to write a short handoff to the memory file. The old session stays until the user closes it.

### The Mates page

- Each mate shows its conversations, live and past, and a "New conversation" button.
- The page works with no Slack fields.
- The main window of the Mac app has a visible Mates entry. Window › Mates and ⇧⌘M stay.

### What stays from ADR 0053

- A mate that is connected to Slack keeps all the rules of ADR 0053: Slack text is not trusted, owner checks, guards and approvals.

## Consequences

- A new user can use mates with no Slack app and no admin approval.
- A mate can write to its memory file. Thus text in a Slack thread can change the memory of a mate that is connected to Slack. The owner sees the memory on the Mates page and can clear it.
- The memory limit keeps the system prompt small.

## Alternatives

- **Keep the full transcript of old conversations.** Rejected. This fills the context window, and that is the problem.
- **A summary that crew writes with a different model call.** Rejected. It adds a model call and a cost. The mate knows best what to keep.
- **One memory for all mates.** Rejected. Each mate has its own personality.
