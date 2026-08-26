---
"@theokit/sdk": minor
---

Session transcripts are now named with a UUID, so the Claude Code CLI can actually `--continue` a
session this SDK wrote.

That interoperability is the difference this project claims over a proprietary session store, and it
did not hold. Measured against CLI 2.1.236: a transcript resumes only when its basename is a UUID —
`billing-bot.jsonl` and `agent-<uuid>.jsonl` are both ignored, silently, with the session simply not
offered. Every session written under a human-readable agent id was invisible.

The filename is now derived from the agent id with UUIDv5, so it is deterministic: the same agent id
always yields the same transcript and nothing has to be persisted to map one back to the other. An
agent id that is already a UUID passes through unchanged, so a transcript Claude Code wrote keeps its
own name and the two directions stay symmetric.

Existing transcripts are not orphaned: a session whose file already exists under the old name keeps
using it, so history continues to accumulate in one place rather than being abandoned for an empty
file under the new name. Those sessions do not gain `--continue` support — their name is what the CLI
cannot read — but nothing that was written is lost or hidden.
