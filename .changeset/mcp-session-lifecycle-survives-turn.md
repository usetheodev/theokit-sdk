---
"@theokit/sdk": patch
---

`mcpLifecycle: 'session'` now actually keeps the MCP server alive between turns (theokit#155).

The option pooled the client *object* but not the child *process*: every run's `finally` closed
every client it had been handed, so the previous turn SIGTERM'd the server and the next turn's
`initialize()` spawned a new one. Measured at 146 ms +/- 28 (n=12) of spawn + handshake per turn
for one stdio server, paid identically under `'run'` and `'session'` — the knob bought 0 ms.

Two changes, both needed:

- A run now closes only the MCP clients it owns. Under `'session'` the pool owns them, and they are
  released by `dispose()` (or by the idle reaper), not by the turn that borrowed them.
- `initialize()` is a no-op while the child is live, so the per-turn handshake no longer replaces a
  healthy process (which would have orphaned it and paid the spawn cost anyway). The reconnect path
  is unaffected — it re-spawns directly, exactly as before.

The regression tests count child PIDs rather than client objects; counting objects is what let the
defect ship green.
