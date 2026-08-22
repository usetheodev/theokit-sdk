---
"@theokit/sdk": patch
---

A disposed `CloudAgent` now refuses `send()`, as `LocalAgent` already did.

`CloudAgent` tracked a `disposed` flag but consulted it only to make `dispose()` idempotent — `send()`
never checked it. So after disposing a cloud agent, sending still started a real run and resolved with
a live `CloudRun`, while the identical call on a local agent rejected. A caller reaching a torn-down
handle through a stale reference, a retry, or an `await using` scope that had already exited got work
started on an agent they believed was released.

`send()` now throws `AgentDisposedError` (code `agent_disposed`) before constructing anything, matching
`LocalAgent`. `dispose()` keeps its own idempotence, so `await using` double-dispatch is unaffected.

Thrown rather than returned as a failed run: the error is not retryable and a disposed handle never
becomes un-disposed, so a rejected run would invite retry loops around a condition that cannot clear.
