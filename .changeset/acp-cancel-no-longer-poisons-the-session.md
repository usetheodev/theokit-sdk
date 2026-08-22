---
"@theokit/acp": patch
---

`session/cancel` no longer kills the session.

The session owned exactly one `AbortController`, created at session creation and never replaced, so
cancelling one turn handed every later prompt on that session an already-aborted signal. ACP hosts
routinely cancel a turn and then prompt again: the agent silently stopped answering while the host
stayed connected and the session stayed listed.

The abort scope is now armed per turn, which is what `session/cancel` means — the host stops the
answer being written, not the conversation. Cancelling the turn in flight still works.
