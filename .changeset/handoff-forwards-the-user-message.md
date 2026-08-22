---
"@theokit/sdk-handoff": patch
---

A handoff now tells the receiving agent what the user asked.

Both wirings built the transfer tool through a handler that dispatched with an empty transcript, so
the receiver was sent the literal string `(Handoff from <sender> — no prior user message in
history.)` and answered from that plus its own system prompt. The handler now forwards the
supervisor's transcript, which the SDK hands every tool handler, and the dispatcher takes the last
user turn from it.

`HandoffOptions.inputFilter` was dead in the same way — invoked, always with nothing to filter, so a
caller who wired a redactor believed the transcript was being scrubbed. It now receives the real
transcript, and dropping a message there does keep it from the receiver.
