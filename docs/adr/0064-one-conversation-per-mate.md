# ADR 0064: One conversation for each mate

Status: accepted, 2026-10-23. Tracking issue: #836. It amends [ADR 0053](0053-mates.md) and [ADR 0056](0056-local-mates.md).

## Context

Before this ADR, a mate had many threads. Each Slack thread started its own session. Each "New" in the app started its own session. Each automation run started its own session. Thus the context of the mate was in many sessions, and the owner had to select a thread to talk to the mate.

The owner wants a mate to work as one person: one conversation that gets all the messages.

## Decision

### One conversation

- Each mate has one **conversation**. It is the newest session of the mate that is not **history** (`domain.MateConversation`).
- These inputs all go into the conversation: the composer of the app (`mate.new`), a mention in a Slack channel, a Slack direct message (that is not a claim code) and an automation run that names the mate.
- If the mate has no conversation, the first input starts one. If the conversation ended, the daemon resumes it first. If it cannot resume it, the daemon starts a new one.

### Concurrent inputs

- An input does not start a session. It goes into the send queue of the conversation (`session.send`). The queue keeps the inputs in order. Thus a busy mate answers each input in turn.
- Each queued input keeps its **seat** (the authority of the person or mate that asked) and its **reply thread** (`domain.MateInput`).
- When the send goes out to the agent, the daemon applies the seat to the session (`domain.MateTurnSeat`) and sets the reply thread. Thus:
  - A Slack turn goes through the gate (`Local` is false), also in a conversation that the app started.
  - An app or automation turn acts as the owner (`Local` is true).
  - The authority of one turn never goes to a different turn.

### Replies

- A Slack input keeps its channel and `thread_ts`. The daemon links each Slack thread to the conversation (`domain.MateThread`). At `Stop`, the daemon posts the result in the reply thread of the turn, then forgets it. Thus the answer goes to the Slack thread or DM where the message came from.
- An app or automation input has no reply thread. The app shows all of the conversation.
- Each input starts with a source tag on its first line (`domain.MateSourcePrompt`): `[Source: #<channel>]`, `[Source: DM]` or `[Source: Automation <name>]`. App input has no tag. The tag is on the same line as the text, so a harness that splits a paste by line keeps the tag with the text. The app reads it and shows a tag on the message (App, #channel, DM, Automation).

### Start fresh

- "Start fresh" marks the conversation as history (`MateSeat.History`) and ends it. The transcript stays. You can read it, but no input goes to it again. The next input starts a new conversation.
- It is in the ⋯ menu of the mate header, with a confirm. It is also `crew mate reset <name>`, `mate.reset` and `POST /api/v1/mates/{name}/reset`.
- `mate.fresh` (with a handoff to the memory file) also marks the old session as history.

### Worktree

- The conversation has one worktree: the worktree of the session that started it. All inputs, also automation runs, work in that worktree. The owner can start fresh to get a new worktree.
- An automation of a mate does not start its own session or worktree. The rule "skip when the session of the last run is live" does not apply to it, because the conversation is always live. Each run appends one input to the queue. The run is `succeeded` when the input is in the queue, and its session is the conversation.

### Turn limits

- The guards of ADR 0053 do not change. Each Slack input that goes into the queue counts as one turn. The hop limit uses the seat of the newest input that the other mate asked.

### Migration

- No data changes. A mate with several old sessions has the newest one as its conversation (`domain.MateConversation`). The other sessions show as history. Old Slack links stay. A reply in an old thread that does not go to the conversation is ignored unless it mentions the mate.

## Consequences

- One context for each mate. It gets longer, so the owner uses Start fresh more often.
- A long turn of one input makes the other inputs wait.
- The app has no thread list. The conversation fills the middle of the mate page.
- A channel tag shows the channel ID, because the daemon does not look up channel names.
