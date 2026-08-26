---
"@theokit/sdk": minor
---

A memory fact can now say what it IS and when it was learned.

`MemoryFact` gains an optional `kind` — `user`, `feedback`, `project` or `reference` — and a
`modified` timestamp. Without them a durable preference and a project note that went stale were
indistinguishable: no staleness signal, no way for recall to filter, no basis for selective
retention, and no way for a surface to separate "what I remember about you" from "what I know about
this project".

Additive, so existing stores keep working. A hand-written bullet under `## Facts` still parses and
stays untyped — a kind is never inferred, because a wrong one makes recall confident about the wrong
thing. `modified` is stamped by the SDK and ignored when supplied by a caller: a timestamp a caller
can set is one that can lie about when something was learned.
