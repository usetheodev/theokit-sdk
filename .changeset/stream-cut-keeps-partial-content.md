---
"@theokit/sdk": patch
---

A stream cut mid-flight now delivers the text that already arrived, instead of dropping it.

Measured on a 200-chunk answer severed just before its terminator: the provider sent 1490 characters
and the consumer received none. Truncated streams are routine — proxy timeouts, load-balancer idle
limits, mobile links — and every one of them turned a mostly-complete answer into nothing, the more
so the longer the answer. The run is still reported as errored; what the caller gets back is the
choice of whether a partial answer is usable.

A body read that fails mid-stream is also routed through the transport-error mapper, so it reads
`openai transport failure on /v1/chat/completions: terminated` and carries `code:
"transport_failure"` instead of undici's bare `terminated` with no code. `RunResult.usage` is
documented as absent for such a run: the counts arrive with the terminating frame a severed
connection never delivers.
