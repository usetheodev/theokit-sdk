---
"@theokit/sdk": minor
---

Session transcripts are now named with a UUID, so the Claude Code CLI can actually `--continue` a
session this SDK wrote.

That interoperability is the difference this project claims over a proprietary session store, and it
did not hold. Measured against CLI 2.1.236: a transcript resumes only when its basename is a UUID —
`billing-bot.jsonl` and `agent-<uuid>.jsonl` are both ignored, silently, with the session simply not
offered. Every session written under a human-readable agent id was invisible.

The filename is now derived from the agent id with a UUIDv8 over SHA-256, so it is deterministic:
the same agent id always yields the same transcript and nothing has to be persisted to map one back
to the other. Version 8 is RFC 9562's slot for an implementation-defined scheme, which is what this
is — v5 would have been the obvious choice but RFC 4122 fixes its hash to SHA-1, and a weak
primitive in the tree costs a permanent argument with every scanner that sees it. An
agent id that is already a UUID passes through unchanged, so a transcript Claude Code wrote keeps its
own name and the two directions stay symmetric.

Existing transcripts are not orphaned: a session whose file already exists under the old name keeps
using it, so history continues to accumulate in one place rather than being abandoned for an empty
file under the new name. Those sessions do not gain `--continue` support — their name is what the CLI
cannot read — but nothing that was written is lost or hidden.
